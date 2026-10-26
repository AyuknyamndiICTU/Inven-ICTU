import type { IdentifyResponse, KioskConfig } from '@labpass/contracts';
import { parseResponseQr } from '@labpass/contracts/tap';
import type { z } from 'zod';
import {
  type commandSchemas,
  type CommandName,
  type CommandOutputs,
  type IdentifiedView,
  type IdentifyView,
  type KioskEquipment,
  type KioskError,
  type KioskEvent,
  type KioskStatus,
  type ReaderStatus,
  toView,
} from '../shared/ipc';
import { ChallengePool } from './challenge-pool';
import { type ConfigStore, isAcceptableApiUrl } from './config';
import { inlineImage, isAuthError, isNetworkError, KioskApi, KioskApiError, toKioskError } from './kiosk-api';
import type { RotatingLog } from './logger';
import { relayDesfire } from './reader/desfire-relay';
import type { ReaderDriver } from './reader/driver';
import { TapService, type TapResult } from './reader/tap-service';

export interface SocketLike {
  on(event: string, listener: (payload: unknown) => void): void;
  disconnect(): void;
}
export type SocketFactory = (namespaceUrl: string, token: string) => SocketLike;

export interface KioskServiceDeps {
  store: ConfigStore;
  driver: ReaderDriver;
  log: Pick<RotatingLog, 'info' | 'warn' | 'error'>;
  emit: (event: KioskEvent) => void;
  socket: SocketFactory;
  appVersion: string;
  dev: boolean;
  fetch?: typeof fetch;
  allowHttp?: boolean;
  heartbeatMs?: number;
  poolTickMs?: number;
  /** Assistant actions that need the Electron app object. */
  onQuit?: () => void;
  onReload?: () => void;
  /** FakeReader scenarios (dev builds only). */
  simulate?: (scenario: z.output<(typeof commandSchemas)['devSimulate']>['scenario']) => void;
}

type Input<C extends CommandName> = z.output<(typeof commandSchemas)[C]>;
type Handlers = { [C in CommandName]: (input: Input<C>) => Promise<CommandOutputs[C]> };

const ASSISTANT_UNLOCK_MS = 2 * 60_000;
const UNKNOWN_CARD_TTL_MS = 2 * 60_000;

const fail = (code: string, message: string, status = 400): never => {
  throw new KioskApiError({ code, status, message });
};

/**
 * Main-process heart of the kiosk. Owns the device token, the student's kiosk session, the reader and the socket;
 * the renderer only sends named commands and receives sanitised events.
 */
export class KioskService {
  private api: KioskApi;
  private pool: ChallengePool;
  private tap: TapService;
  private socket: SocketLike | null = null;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private reader: { status: ReaderStatus; name: string | null };
  private online = false;
  private config: KioskConfig | null = null;
  private clockOffsetMs = 0;
  private session: { token: string; expiresAt: number } | null = null;
  private unknownUid: { uid: string; at: number } | null = null;
  private assistantUntil = 0;
  private imageCache = new Map<string, string | null>();

  constructor(private readonly d: KioskServiceDeps) {
    this.reader = { status: d.driver.kind === 'fake' ? 'FAKE' : 'DISCONNECTED', name: null };
    this.api = this.makeApi();
    this.pool = this.makePool();
    this.tap = new TapService(d.driver, {
      takeChallenge: () => this.pool.take(),
      kioskId: () => d.store.kioskId,
      now: () => this.now(),
    });
    this.tap.on('present', () => d.emit({ type: 'reader.present' }));
    this.tap.on('removed', () => d.emit({ type: 'reader.removed' }));
    this.tap.on('tap', (r) => void this.onTap(r));
    d.driver.on('status', (status, name) => {
      this.reader = { status, name };
      d.log.info('reader.status', status);
      this.publishStatus();
    });
  }

  private now() {
    return Date.now() + this.clockOffsetMs;
  }

  private makeApi() {
    return new KioskApi(this.d.store.apiUrl, () => this.d.store.deviceToken(), 8000, this.d.fetch);
  }

  private makePool() {
    const pool = new ChallengePool({ fetch: () => this.api.call('kiosk.challenges'), now: () => this.now() });
    pool.onDisplay((c) => c && this.d.emit({ type: 'challenge', ...c }));
    return pool;
  }

  // ───────────── lifecycle ─────────────

  async start() {
    await this.d.driver.start();
    if (this.d.store.registered) await this.connect();
    this.publishStatus();
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.socket?.disconnect();
    this.socket = null;
    this.tap.dispose();
    await this.d.driver.stop();
  }

  private async connect() {
    const token = this.d.store.deviceToken();
    if (!token) return;
    this.socket?.disconnect();
    const socket = this.d.socket(`${this.d.store.apiUrl}/kiosk`, token);
    this.socket = socket;
    socket.on('connect', () => this.setOnline(true));
    socket.on('disconnect', () => this.setOnline(false));
    socket.on('identified', (payload) => this.onScanIdentified(payload as IdentifyResponse));
    socket.on('availability.changed', (p) => {
      const a = p as { equipmentId: string; available: number; health: 'OK' | 'LOW' | 'OUT' };
      this.d.emit({ type: 'availability', ...a });
    });
    socket.on('config.changed', (p) => {
      this.config = p as KioskConfig;
      this.publishStatus();
    });
    socket.on('kiosk.revoked', () => this.revoked());

    for (const t of this.timers) clearInterval(t);
    this.timers = [
      setInterval(() => void this.heartbeat(), this.d.heartbeatMs ?? 30_000),
      setInterval(() => void this.pool.tick().catch(() => undefined), this.d.poolTickMs ?? 5000),
    ];
    await this.heartbeat();
    await this.pool.tick().catch(() => undefined);
  }

  private async heartbeat() {
    if (!this.d.store.registered) return;
    try {
      const res = await this.api.call('kiosk.heartbeat', {
        body: {
          appVersion: this.d.appVersion,
          readerStatus: this.reader.status,
          pendingOfflineTx: 0,
        },
      });
      this.clockOffsetMs = Date.parse(res.serverTime) - Date.now();
      this.config = res.config;
      this.setOnline(true);
    } catch (e) {
      const err = toKioskError(e);
      if (isAuthError(err)) return this.revoked();
      if (isNetworkError(err)) this.setOnline(false);
      this.d.log.warn('heartbeat.failed', err.code);
    }
  }

  private setOnline(online: boolean) {
    if (this.online === online) return;
    this.online = online;
    this.d.log.info(online ? 'api.online' : 'api.offline');
    this.publishStatus();
  }

  private revoked() {
    this.d.log.warn('kiosk.revoked');
    this.d.store.wipe();
    this.session = null;
    this.pool.clear();
    this.socket?.disconnect();
    this.socket = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.online = false;
    this.d.emit({ type: 'revoked' });
    this.publishStatus();
  }

  status(): KioskStatus {
    return {
      registered: this.d.store.registered,
      kioskId: this.d.store.kioskId,
      appVersion: this.d.appVersion,
      reader: { ...this.reader, kind: this.d.driver.kind },
      online: this.online,
      config: this.config,
      dev: this.d.dev,
    };
  }

  private publishStatus() {
    this.d.emit({ type: 'status', status: this.status() });
  }

  // ───────────── identification ─────────────

  private async withPhoto<T extends IdentifyView>(view: T): Promise<T> {
    if (view.status === 'IDENTIFIED') {
      const photoUrl = await this.image(view.student.photoUrl);
      return { ...view, student: { ...view.student, photoUrl } };
    }
    if (view.status === 'VERIFICATION_REQUIRED') {
      const photoUrl = await this.image(view.student.photoUrl);
      return { ...view, student: { ...view.student, photoUrl } };
    }
    return view;
  }

  private async image(url: string | null): Promise<string | null> {
    if (!url) return null;
    const key = url.split('?')[0]!;
    if (this.imageCache.has(key)) return this.imageCache.get(key)!;
    const data = await inlineImage(url, this.d.store.apiUrl, this.d.fetch);
    if (this.imageCache.size > 200) this.imageCache.clear();
    this.imageCache.set(key, data);
    return data;
  }

  /** Keeps the session in main and returns the sanitised view for the renderer. */
  private async accept(result: IdentifyResponse): Promise<IdentifyView> {
    if (result.status === 'IDENTIFIED') {
      this.session = { token: result.session.token, expiresAt: Date.parse(result.session.expiresAt) };
    } else {
      this.session = null;
    }
    return this.withPhoto(toView(result));
  }

  private async onTap(r: TapResult) {
    if (!this.d.store.registered) return;
    if (r.kind === 'ERROR') {
      this.d.log.info('tap.error', r.code);
      void this.d.driver.feedback('error');
      this.d.emit({ type: 'tap.error', code: r.code });
      return;
    }
    try {
      let result: IdentifyResponse;
      if (r.kind === 'HCE') {
        result = await this.api.call('kiosk.identify', {
          body: { method: 'HCE', credentialId: r.credentialId, nonce: r.nonce, ts: r.ts, signature: r.signature },
        });
      } else {
        result = await this.identifyCard(r);
      }
      if (result.status === 'UNKNOWN_CARD' && r.kind === 'CARD') this.unknownUid = { uid: r.uid, at: this.now() };
      this.d.log.info('identify.result', `${r.kind} ${result.status}`);
      void this.d.driver.feedback(result.status === 'UNKNOWN_CARD' ? 'error' : 'ok');
      this.d.emit({ type: 'identify.result', result: await this.accept(result), via: r.kind });
    } catch (e) {
      const error = toKioskError(e);
      this.d.log.warn('identify.failed', `${r.kind} ${error.code}`);
      if (isNetworkError(error)) this.setOnline(false);
      void this.d.driver.feedback('error');
      this.d.emit({ type: 'identify.error', error });
    }
  }

  private async identifyCard(r: Extract<TapResult, { kind: 'CARD' }>): Promise<IdentifyResponse> {
    const mode = this.config?.cardAuthMode ?? 'UID';
    if (mode !== 'UID') {
      const outcome = await relayDesfire(r.card, r.uid, {
        start: (uid) => this.api.call('kiosk.cardAuthStart', { body: { uid } }),
        step: (sessionId, response) => this.api.call('kiosk.cardAuthStep', { body: { sessionId, response } }),
      });
      if (outcome.kind === 'DONE') return outcome.result;
      this.d.log.info('cardAuth.uidOnly', outcome.reason);
    }
    return this.api.call('kiosk.identify', { body: { method: 'CARD', uid: r.uid } });
  }

  private onScanIdentified(payload: IdentifyResponse) {
    this.pool.rotateDisplayed();
    void (async () => {
      this.d.log.info('identify.result', 'SCAN IDENTIFIED');
      this.d.emit({ type: 'identify.result', result: await this.accept(payload), via: 'SCAN' });
    })();
  }

  private requireSession(): string {
    if (!this.session || this.session.expiresAt <= this.now()) {
      this.session = null;
      return fail('SESSION_EXPIRED', 'Your session has ended. Tap again.', 401);
    }
    return this.session.token;
  }

  private requireRegistered() {
    if (!this.d.store.registered) fail('NOT_REGISTERED', 'This kiosk is not registered', 409);
  }

  private requireAssistant() {
    if (this.now() > this.assistantUntil) fail('ASSISTANT_LOCKED', 'Enter the service PIN first', 403);
  }

  // ───────────── commands (validated input from IPC) ─────────────

  readonly commands: Handlers = {
    status: async () => this.status(),

    register: async ({ code, apiUrl, servicePin }) => {
      if (this.d.store.registered) fail('ALREADY_REGISTERED', 'This kiosk is already registered', 409);
      if (apiUrl) {
        if (!isAcceptableApiUrl(apiUrl, this.d.allowHttp))
          fail('BAD_API_URL', 'Use the HTTPS address of the LabPass server');
        this.d.store.setApiUrl(apiUrl);
        this.api = this.makeApi();
        this.pool = this.makePool();
      }
      const res = await this.api.call('kiosk.register', { body: { code, appVersion: this.d.appVersion } });
      this.d.store.saveRegistration(res.kioskId, res.token, servicePin);
      this.d.log.info('kiosk.registered');
      await this.connect();
      this.publishStatus();
      return this.status();
    },

    identifyManual: async ({ matricule }) => {
      this.requireRegistered();
      const res = await this.api.call('kiosk.identify', { body: { method: 'MANUAL', matricule } });
      return this.accept(res);
    },

    verifyManual: async (body) => {
      const res = await this.api.call('kiosk.manualVerify', { body });
      return (await this.accept(res)) as IdentifiedView;
    },

    requestOtp: async ({ lookupId }) => this.api.call('kiosk.manualOtp', { body: { lookupId } }),

    cardLink: async ({ matricule }) => {
      const u = this.unknownUid;
      if (!u || this.now() - u.at > UNKNOWN_CARD_TTL_MS) fail('TAP_AGAIN', 'Tap the card again to link it', 409);
      return this.api.call('kiosk.cardLink', { body: { uid: u!.uid, matricule } });
    },

    cardLinkConfirm: async (body) => {
      const res = await this.api.call('kiosk.cardLinkConfirm', { body });
      this.unknownUid = null;
      return res;
    },

    submitScanResponse: async ({ text }) => {
      this.requireRegistered();
      try {
        parseResponseQr(text);
      } catch {
        fail('NOT_A_LABPASS_CODE', 'This is not a LabPass response code');
      }
      const res = await this.api.call('kiosk.identify', { body: { method: 'SCAN', payload: text.trim() } });
      return this.accept(res);
    },

    equipment: async () => {
      const list = await this.api.call('kiosk.equipment');
      return Promise.all(
        list.map(async (it): Promise<KioskEquipment> => ({
          id: it.id,
          code: it.code,
          name: it.name,
          categoryName: it.categoryName,
          imageUrl: await this.image(it.imageUrl),
          available: it.available,
          health: it.health,
        })),
      );
    },

    ticker: async () => this.api.call('kiosk.ticker'),

    signIn: async ({ idempotencyKey, lines }) => {
      const session = this.requireSession();
      const receipt = await this.api.call('kiosk.signIn', { body: { session, lines }, idempotencyKey });
      this.d.log.info('lending.signIn', String(lines.length));
      this.session = null;
      return receipt;
    },

    signOut: async ({ idempotencyKey, lines }) => {
      const session = this.requireSession();
      const receipt = await this.api.call('kiosk.signOut', { body: { session, lines }, idempotencyKey });
      this.d.log.info('lending.signOut', String(lines.length));
      this.session = null;
      return receipt;
    },

    endSession: async () => {
      this.session = null;
      return null;
    },

    assistantUnlock: async ({ pin }) => {
      const unlocked = this.d.store.verifyServicePin(pin);
      this.d.log.info(unlocked ? 'assistant.unlocked' : 'assistant.denied');
      this.assistantUntil = unlocked ? this.now() + ASSISTANT_UNLOCK_MS : 0;
      return { unlocked };
    },

    assistantAction: async ({ action }) => {
      this.requireAssistant();
      this.d.log.info('assistant.action', action);
      if (action === 'retryReader') {
        await this.d.driver.stop();
        await this.d.driver.start();
      } else if (action === 'unregister') {
        this.revoked();
      } else if (action === 'quit') {
        this.d.onQuit?.();
      } else if (action === 'reload') {
        this.d.onReload?.();
      }
      return null;
    },

    devSimulate: async ({ scenario }) => {
      if (!this.d.dev || !this.d.simulate) fail('NOT_AVAILABLE', 'Simulation is only available in development', 404);
      this.d.simulate!(scenario);
      return null;
    },
  };

  /** Entry point for the IPC layer and tests: network failures flip the kiosk to offline (K9-offline). */
  async run<C extends CommandName>(command: C, input: Input<C>): Promise<CommandOutputs[C]> {
    try {
      return await (this.commands[command] as (i: Input<C>) => Promise<CommandOutputs[C]>)(input);
    } catch (e) {
      const err = toKioskError(e);
      if (isNetworkError(err)) this.setOnline(false);
      if (err.code === 'INTERNAL') this.d.log.error('command.failed', command);
      throw new KioskApiError(err);
    }
  }
}

export type { KioskError };
