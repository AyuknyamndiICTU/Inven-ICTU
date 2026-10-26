/**
 * In-memory LabPass API for kiosk tests and the Playwright e2e (no database). It mirrors the contract closely —
 * every response is validated by the kiosk's client — and checks real HCE signatures against the tap vectors.
 */
import { defaultSettings, KioskConfig } from '@labpass/contracts';
import { b64urlDecode, b64urlEncode, verifyHceEvidence } from '@labpass/contracts/tap-node';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Server as IoServer } from 'socket.io';

// Resolved from the working directory so this file runs under vitest, Playwright and plain Node alike.
const vectors = createRequire(join(process.cwd(), 'noop.js'))('@labpass/contracts/vectors.json') as {
  ids: { kioskId: string; credentialId: string };
  keys: { device1: { spki: string } };
};

export const MOCK = {
  kioskId: vectors.ids.kioskId,
  registrationCode: 'LAB-PC-01-7Q4K',
  token: 'mock-device-token-0123456789abcdef',
  cardUid: '04A1B2C3D4E5F6',
  credentialId: vectors.ids.credentialId,
  manualMatricule: 'ICTU20230002',
  openMatricule: 'ICTU20230003',
  inactiveMatricule: 'ICTU20230009',
  pin: '2468',
  assistantPin: '1357',
  otp: '424242',
} as const;

interface Student {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  program: string | null;
  level: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

interface Line {
  loanLineId: string;
  loanId: string;
  studentId: string;
  equipmentId: string;
  outstanding: number;
  dueAt: string;
}

type Reply = { status: number; body: unknown };

const iso = (ms: number) => new Date(ms).toISOString();
const later = (min: number) => iso(Date.now() + min * 60_000);

export class MockBackend {
  config = KioskConfig.parse(defaultSettings());
  down = false;
  revoked = false;
  readonly students: Student[] = [
    {
      id: randomUUID(),
      matricule: 'ICTU20231234',
      firstName: 'Ama',
      lastName: 'Mbah',
      program: 'BSc Networks',
      level: 'L3',
      status: 'ACTIVE',
    },
    {
      id: randomUUID(),
      matricule: 'ICTU20220456',
      firstName: 'Brice',
      lastName: 'Tchoua',
      program: 'BSc Software',
      level: 'L2',
      status: 'ACTIVE',
    },
    {
      id: randomUUID(),
      matricule: MOCK.manualMatricule,
      firstName: 'Chantal',
      lastName: 'Ngono',
      program: 'BSc Networks',
      level: 'L1',
      status: 'ACTIVE',
    },
    {
      id: randomUUID(),
      matricule: MOCK.openMatricule,
      firstName: 'Didier',
      lastName: 'Fon',
      program: null,
      level: null,
      status: 'ACTIVE',
    },
    {
      id: randomUUID(),
      matricule: MOCK.inactiveMatricule,
      firstName: 'Esther',
      lastName: 'Ewane',
      program: null,
      level: null,
      status: 'INACTIVE',
    },
  ];
  readonly cards = new Map<string, string>([[MOCK.cardUid, this.students[0]!.id]]);
  readonly credentials = new Map<string, string>([[MOCK.credentialId, this.students[1]!.id]]);
  readonly equipment = [
    { id: randomUUID(), code: 'RTR-2911', name: 'Cisco 2911 Router', categoryName: 'Routers', total: 8, available: 6 },
    { id: randomUUID(), code: 'RTR-4321', name: 'Cisco ISR 4321', categoryName: 'Routers', total: 4, available: 1 },
    {
      id: randomUUID(),
      code: 'SW-2960',
      name: 'Catalyst 2960 Switch',
      categoryName: 'Switches',
      total: 12,
      available: 9,
    },
    {
      id: randomUUID(),
      code: 'SW-3650',
      name: 'Catalyst 3650 Switch',
      categoryName: 'Switches',
      total: 2,
      available: 0,
    },
    {
      id: randomUUID(),
      code: 'CBL-CON',
      name: 'Console cable (RJ45-USB)',
      categoryName: 'Cables',
      total: 30,
      available: 22,
    },
    {
      id: randomUUID(),
      code: 'CBL-CAT6',
      name: 'Patch cable Cat6 2 m',
      categoryName: 'Cables',
      total: 60,
      available: 41,
    },
  ];
  readonly lines: Line[] = [];
  readonly challenges = new Map<string, number>();
  readonly sessions = new Map<string, { studentId: string; expiresAt: number }>();
  readonly lookups = new Map<string, { studentId: string; attempts: number }>();
  readonly idempotency = new Map<string, Reply>();
  readonly calls: string[] = [];
  private io: IoServer | null = null;
  private server: Server | null = null;

  constructor() {
    this.lines.push({
      loanLineId: randomUUID(),
      loanId: randomUUID(),
      studentId: this.students[0]!.id,
      equipmentId: this.equipment[4]!.id,
      outstanding: 2,
      dueAt: later(240),
    });
  }

  // ───────────── helpers ─────────────

  private problem(status: number, code: string, detail: string, extensions?: Record<string, unknown>): Reply {
    return {
      status,
      body: { type: 'about:blank', title: code, status, code, detail, ...(extensions ? { extensions } : {}) },
    };
  }

  private health(e: { total: number; available: number }): 'OK' | 'LOW' | 'OUT' {
    if (e.available === 0) return 'OUT';
    return e.available <= Math.max(1, Math.floor(e.total * 0.2)) ? 'LOW' : 'OK';
  }

  private openLines(studentId: string) {
    return this.lines
      .filter((l) => l.studentId === studentId && l.outstanding > 0)
      .map((l) => {
        const e = this.equipment.find((x) => x.id === l.equipmentId)!;
        return {
          loanLineId: l.loanLineId,
          loanId: l.loanId,
          equipmentId: e.id,
          equipmentCode: e.code,
          equipmentName: e.name,
          outstanding: l.outstanding,
          dueAt: l.dueAt,
          overdue: Date.parse(l.dueAt) < Date.now(),
        };
      });
  }

  identified(s: Student, method: 'CARD' | 'HCE' | 'SCAN' | 'MANUAL', flags: Array<'MANUAL' | 'UID_ONLY'> = []) {
    const token = `sess.${randomBytes(18).toString('base64url')}`;
    const expiresAt = Date.now() + 120_000;
    this.sessions.set(token, { studentId: s.id, expiresAt });
    const active = s.status === 'ACTIVE';
    return {
      status: 'IDENTIFIED' as const,
      method,
      session: { token, expiresAt: iso(expiresAt) },
      student: { ...s, photoUrl: null },
      eligibility: {
        canBorrow: active,
        canReturn: true,
        reasons: active ? [] : ['INACTIVE'],
        remainingItems: null,
      },
      openLines: this.openLines(s.id),
      flags,
    };
  }

  emit(event: string, payload: unknown) {
    this.io?.of('/kiosk').emit(event, payload);
  }

  /** Simulates F3: a phone scanned the displayed challenge, so the API pushes `identified` to the kiosk socket. */
  async scanBy(matricule = 'ICTU20220456') {
    // Socket.IO drops broadcasts while a client is reconnecting; wait for the kiosk like the real API's room would.
    for (let i = 0; i < 100 && (this.io?.of('/kiosk').sockets.size ?? 0) === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = this.students.find((x) => x.matricule === matricule)!;
    this.emit('identified', this.identified(s, 'SCAN'));
  }

  // ───────────── request router ─────────────

  async handle(
    method: string,
    path: string,
    headers: Record<string, string | undefined>,
    body: unknown,
  ): Promise<Reply> {
    this.calls.push(`${method} ${path}`);
    const b = (body ?? {}) as Record<string, unknown>;

    if (method === 'POST' && path === '/kiosk/register') {
      if (b.code !== MOCK.registrationCode)
        return this.problem(400, 'INVALID_CODE', 'This registration code is not valid.');
      this.revoked = false;
      return { status: 200, body: { kioskId: MOCK.kioskId, token: MOCK.token } };
    }
    if (headers.authorization !== `Bearer ${MOCK.token}` || this.revoked)
      return this.problem(401, 'UNAUTHENTICATED', 'Kiosk token required');

    switch (`${method} ${path}`) {
      case 'POST /kiosk/heartbeat':
        return { status: 200, body: { serverTime: new Date().toISOString(), config: this.config } };
      case 'POST /kiosk/challenges': {
        const challenges = Array.from({ length: 3 }, () => {
          const nonce = b64urlEncode(new Uint8Array(randomBytes(16)));
          const exp = Date.now() + 60_000;
          this.challenges.set(nonce, exp);
          return { nonce, expiresAt: iso(exp) };
        });
        return { status: 200, body: { kioskId: MOCK.kioskId, challenges } };
      }
      case 'GET /kiosk/equipment':
        return {
          status: 200,
          body: this.equipment.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.name,
            categoryId: '9b2f7c1e-3d4a-4b5c-8d6e-7f8091a2b3c4',
            categoryName: e.categoryName,
            imageUrl: null,
            available: e.available,
            health: this.health(e),
          })),
        };
      case 'GET /kiosk/ticker':
        return {
          status: 200,
          body: [
            { at: later(-2), kind: 'RETURN', equipmentName: 'Cisco 2911 Router', quantity: 1 },
            { at: later(-5), kind: 'BORROW', equipmentName: 'Console cable (RJ45-USB)', quantity: 2 },
            { at: later(-9), kind: 'BORROW', equipmentName: 'Catalyst 2960 Switch', quantity: 1 },
          ],
        };
      case 'POST /kiosk/identify':
        return this.identify(b);
      case 'POST /kiosk/manual/verify':
        return this.verify(b);
      case 'POST /kiosk/manual/otp':
        return { status: 200, body: { destination: 'c•••@ictuniversity.edu.cm' } };
      case 'POST /kiosk/card-link':
        return {
          status: 200,
          body: { requestId: randomUUID(), verification: 'OTP', destination: 'c•••@ictuniversity.edu.cm' },
        };
      case 'POST /kiosk/card-link/confirm':
        return b.code === MOCK.otp
          ? { status: 200, body: { status: 'LINKED' } }
          : this.problem(400, 'VERIFICATION_FAILED', 'That code is not right.');
      case 'POST /kiosk/sign-in':
        return this.idempotent(headers, () => this.signIn(b));
      case 'POST /kiosk/sign-out':
        return this.idempotent(headers, () => this.signOut(b));
      default:
        return this.problem(404, 'NOT_FOUND', `${method} ${path} is not mocked`);
    }
  }

  private idempotent(headers: Record<string, string | undefined>, run: () => Reply): Reply {
    const key = headers['idempotency-key'];
    if (!key) return this.problem(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header.');
    const prior = this.idempotency.get(key);
    if (prior) return prior;
    const res = run();
    if (res.status < 500) this.idempotency.set(key, res);
    return res;
  }

  private identify(b: Record<string, unknown>): Reply {
    const notRecognised = () =>
      this.problem(422, 'NOT_RECOGNISED', 'We could not verify this. Try again, or use your matricule.');
    if (b.method === 'CARD') {
      const sid = this.cards.get(String(b.uid).toUpperCase());
      if (!sid) return { status: 200, body: { status: 'UNKNOWN_CARD', uidSuffix: String(b.uid).slice(-4) } };
      return {
        status: 200,
        body: this.identified(
          this.students.find((s) => s.id === sid)!,
          'CARD',
        ),
      };
    }
    if (b.method === 'HCE') {
      const nonce = String(b.nonce);
      const exp = this.challenges.get(nonce);
      this.challenges.delete(nonce);
      if (!exp || exp < Date.now()) return notRecognised();
      const ok = verifyHceEvidence(b64urlDecode(vectors.keys.device1.spki), {
        credentialId: String(b.credentialId),
        nonce: b64urlDecode(nonce),
        kioskId: MOCK.kioskId,
        ts: Number(b.ts),
        signature: b64urlDecode(String(b.signature)),
      });
      const sid = this.credentials.get(String(b.credentialId));
      if (!ok || !sid) return notRecognised();
      return {
        status: 200,
        body: this.identified(
          this.students.find((s) => s.id === sid)!,
          'HCE',
        ),
      };
    }
    if (b.method === 'SCAN') return notRecognised();
    const s = this.students.find((x) => x.matricule === String(b.matricule).toUpperCase());
    if (!s)
      return this.problem(422, 'NOT_RECOGNISED', 'We could not find this matricule. Check it, or ask a lab assistant.');
    if (s.matricule === MOCK.openMatricule) return { status: 200, body: this.identified(s, 'MANUAL', ['MANUAL']) };
    const lookupId = randomUUID();
    this.lookups.set(lookupId, { studentId: s.id, attempts: 0 });
    return {
      status: 200,
      body: {
        status: 'VERIFICATION_REQUIRED',
        lookupId,
        student: { firstName: s.firstName, lastName: s.lastName, photoUrl: null },
        options: ['PIN', 'ASSISTANT', 'OTP'],
      },
    };
  }

  private verify(b: Record<string, unknown>): Reply {
    const lookup = this.lookups.get(String(b.lookupId));
    if (!lookup) return this.problem(400, 'LOOKUP_EXPIRED', 'This entry has expired. Type the matricule again.');
    const ok =
      (b.method === 'PIN' && b.pin === MOCK.pin) ||
      (b.method === 'ASSISTANT' && b.assistantPin === MOCK.assistantPin) ||
      (b.method === 'OTP' && b.code === MOCK.otp);
    if (!ok) {
      lookup.attempts++;
      return this.problem(400, 'VERIFICATION_FAILED', `That is not right. ${5 - lookup.attempts} attempt(s) left.`);
    }
    this.lookups.delete(String(b.lookupId));
    return {
      status: 200,
      body: this.identified(
        this.students.find((x) => x.id === lookup.studentId)!,
        'MANUAL',
        ['MANUAL'],
      ),
    };
  }

  private studentFor(b: Record<string, unknown>): Student | null {
    const s = this.sessions.get(String(b.session));
    return s && s.expiresAt > Date.now() ? this.students.find((x) => x.id === s.studentId)! : null;
  }

  private signIn(b: Record<string, unknown>): Reply {
    const student = this.studentFor(b);
    if (!student) return this.problem(401, 'SESSION_EXPIRED', 'Your session has ended. Tap again.');
    if (student.status !== 'ACTIVE')
      return this.problem(403, 'STUDENT_INACTIVE', 'Your student account is not active.');
    const lines = b.lines as Array<{ equipmentId: string; quantity: number }>;
    for (const l of lines) {
      const e = this.equipment.find((x) => x.id === l.equipmentId);
      if (!e) return this.problem(404, 'NOT_FOUND', 'Equipment was not found.');
      if (e.available < l.quantity)
        return this.problem(409, 'INSUFFICIENT_STOCK', `Only ${e.available} × ${e.name} left.`, {
          equipmentId: e.id,
          available: e.available,
        });
    }
    const loanId = randomUUID();
    const dueAt = later(240);
    for (const l of lines) {
      const e = this.equipment.find((x) => x.id === l.equipmentId)!;
      e.available -= l.quantity;
      this.lines.push({
        loanLineId: randomUUID(),
        loanId,
        studentId: student.id,
        equipmentId: e.id,
        outstanding: l.quantity,
        dueAt,
      });
      this.emit('availability.changed', { equipmentId: e.id, available: e.available, health: this.health(e) });
    }
    this.sessions.delete(String(b.session));
    return {
      status: 201,
      body: {
        kind: 'BORROW',
        loanIds: [loanId],
        occurredAt: new Date().toISOString(),
        dueAt,
        studentFirstName: student.firstName,
        lines: lines.map((l) => ({
          equipmentId: l.equipmentId,
          equipmentName: this.equipment.find((x) => x.id === l.equipmentId)!.name,
          quantity: l.quantity,
          condition: null,
        })),
        offline: false,
      },
    };
  }

  private signOut(b: Record<string, unknown>): Reply {
    const student = this.studentFor(b);
    if (!student) return this.problem(401, 'SESSION_EXPIRED', 'Your session has ended. Tap again.');
    const req = b.lines as Array<{ loanLineId: string; quantity: number; condition: 'OK' | 'DAMAGED' }>;
    for (const r of req) {
      const line = this.lines.find((l) => l.loanLineId === r.loanLineId && l.studentId === student.id);
      if (!line || line.outstanding < r.quantity)
        return this.problem(409, 'ALREADY_RETURNED', 'This loan is already closed.', {
          loanLineId: r.loanLineId,
          outstanding: line?.outstanding ?? 0,
        });
    }
    const loanIds = new Set<string>();
    const out = req.map((r) => {
      const line = this.lines.find((l) => l.loanLineId === r.loanLineId)!;
      loanIds.add(line.loanId);
      line.outstanding -= r.quantity;
      const e = this.equipment.find((x) => x.id === line.equipmentId)!;
      if (r.condition === 'OK') e.available += r.quantity;
      return { equipmentId: e.id, equipmentName: e.name, quantity: r.quantity, condition: r.condition };
    });
    this.sessions.delete(String(b.session));
    return {
      status: 200,
      body: {
        kind: 'RETURN',
        loanIds: [...loanIds],
        occurredAt: new Date().toISOString(),
        dueAt: null,
        studentFirstName: student.firstName,
        lines: out,
        offline: false,
      },
    };
  }

  // ───────────── adapters ─────────────

  /** A `fetch` for unit tests (no sockets). `down` models an unreachable server. */
  fetch: typeof fetch = async (input, init) => {
    if (this.down) throw new TypeError('fetch failed');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string | undefined> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const res = await this.handle(init?.method ?? 'GET', url.pathname, headers, body);
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': res.status >= 400 ? 'application/problem+json' : 'application/json' },
    });
  };

  /** Real HTTP + Socket.IO server for the Electron e2e. Resolves with the base URL. */
  async listen(port = 0): Promise<string> {
    const server = createServer((req, res) => void this.onHttp(req, res));
    this.server = server;
    const io = new IoServer(server);
    this.io = io;
    io.of('/kiosk').use((socket, next) => {
      const token = (socket.handshake.auth as { token?: string }).token;
      next(token === MOCK.token && !this.revoked ? undefined : new Error('unauthorized'));
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  private async onHttp(req: IncomingMessage, res: ServerResponse) {
    if (this.down) {
      req.socket.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
    const url = new URL(req.url ?? '/', 'http://x');
    const out = await this.handle(
      req.method ?? 'GET',
      url.pathname,
      headers,
      raw ? (JSON.parse(raw) as unknown) : undefined,
    );
    res.writeHead(out.status, { 'Content-Type': out.status >= 400 ? 'application/problem+json' : 'application/json' });
    res.end(JSON.stringify(out.body));
  }

  async close() {
    await this.io?.close();
    await new Promise<void>((r) => (this.server?.listening ? this.server.close(() => r()) : r()));
  }
}
