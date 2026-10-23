import { Controller, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, Req, Res } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { API_ENV, type ApiEnv } from '../config/env';
import { SecretBox } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { isValidCron, JobsService } from '../platform/jobs/jobs';
import { PrismaService } from '../platform/prisma/prisma.service';
import { DirectoryService } from './directory.service';

const CONNECTOR_KEY = '_directoryConnector';
const SYNC_JOB = 'directory-sync';

interface StoredConnector {
  enabled: boolean;
  baseUrl: string | null;
  auth:
    | { type: 'NONE' }
    | { type: 'API_KEY'; header: string; keySealed?: string }
    | { type: 'OAUTH2'; tokenUrl: string; clientId: string; secretSealed?: string };
  studentsPath: string;
  pagination: 'NONE' | 'PAGE' | 'CURSOR';
  itemsPath: string;
  mapping: Record<string, string>;
  scheduleCron: string | null;
  lastSyncAt: string | null;
}

const DEFAULT: StoredConnector = {
  enabled: false,
  baseUrl: null,
  auth: { type: 'NONE' },
  studentsPath: '/students',
  pagination: 'PAGE',
  itemsPath: 'items',
  mapping: {},
  scheduleCron: null,
  lastSyncAt: null,
};

/** Rejects destinations that could reach cloud metadata or internal services the SIS has no business with (SSRF). */
export async function assertSafeUrl(raw: string, production: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Errors.badRequest('INVALID_URL', 'The SIS URL is not valid.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) {
    throw Errors.badRequest('INVALID_URL', 'The SIS URL must use https.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw Errors.badRequest('INVALID_URL', 'The SIS host cannot be resolved.');
  for (const a of addresses) {
    const blocked =
      a.startsWith('169.254.') ||
      a === '0.0.0.0' ||
      a.startsWith('fe80:') ||
      a === '::' ||
      (production && (a.startsWith('127.') || a === '::1'));
    if (blocked) throw Errors.badRequest('INVALID_URL', 'The SIS URL points to a forbidden address.');
  }
  return url;
}

function get(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

@Injectable()
export class ConnectorService implements OnApplicationBootstrap {
  private readonly logger = new Logger('DirectorySync');

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly directory: DirectoryService,
    private readonly jobs: JobsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async stored(): Promise<StoredConnector> {
    const row = await this.prisma.setting.findUnique({ where: { key: CONNECTOR_KEY } });
    return { ...DEFAULT, ...((row?.value as unknown as StoredConnector) ?? {}) };
  }

  async view() {
    const c = await this.stored();
    const auth =
      c.auth.type === 'API_KEY'
        ? { type: 'API_KEY' as const, header: c.auth.header, hasKey: Boolean(c.auth.keySealed) }
        : c.auth.type === 'OAUTH2'
          ? {
              type: 'OAUTH2' as const,
              tokenUrl: c.auth.tokenUrl,
              clientId: c.auth.clientId,
              hasSecret: Boolean(c.auth.secretSealed),
            }
          : { type: 'NONE' as const };
    return { ...c, auth };
  }

  async update(body: In<'directory.connectorUpdate'>['body'], actorId: string) {
    const current = await this.stored();
    if (body.baseUrl) await assertSafeUrl(body.baseUrl, this.env.NODE_ENV === 'production');
    if (body.scheduleCron && !isValidCron(body.scheduleCron)) {
      throw Errors.badRequest(
        'INVALID_SCHEDULE',
        'Use a 5-field cron schedule, for example "0 2 * * *" (every night at 02:00).',
      );
    }
    let auth: StoredConnector['auth'] = { type: 'NONE' };
    if (body.auth.type === 'API_KEY') {
      const prev = current.auth.type === 'API_KEY' ? current.auth.keySealed : undefined;
      auth = {
        type: 'API_KEY',
        header: body.auth.header,
        keySealed: body.auth.key ? this.box.seal(body.auth.key) : prev,
      };
    } else if (body.auth.type === 'OAUTH2') {
      const prev = current.auth.type === 'OAUTH2' ? current.auth.secretSealed : undefined;
      auth = {
        type: 'OAUTH2',
        tokenUrl: body.auth.tokenUrl,
        clientId: body.auth.clientId,
        secretSealed: body.auth.clientSecret ? this.box.seal(body.auth.clientSecret) : prev,
      };
    }
    const next: StoredConnector = { ...current, ...body, auth, lastSyncAt: current.lastSyncAt };
    await this.prisma.setting.upsert({
      where: { key: CONNECTOR_KEY },
      update: { value: next as unknown as Prisma.InputJsonValue, updatedById: actorId },
      create: { key: CONNECTOR_KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: actorId },
    });
    await this.jobs.schedule(SYNC_JOB, next.enabled ? next.scheduleCron : null);
    return this.view();
  }

  /**
   * Scheduled sync: the SIS feed becomes a preview, committed automatically only when every row is valid.
   * Missing students are never deactivated automatically; an admin reviews anything else.
   */
  async scheduledSync() {
    const c = await this.stored();
    if (!c.enabled || !c.baseUrl) return null;
    const preview = await this.sync(null);
    if (preview.counts.invalid > 0 || preview.counts.new + preview.counts.changed === 0) {
      if (preview.counts.invalid > 0)
        this.logger.warn(
          `scheduled SIS sync left import ${preview.id} for review (${preview.counts.invalid} invalid rows)`,
        );
      return preview;
    }
    return this.directory.commit(preview.id, false);
  }

  async onApplicationBootstrap() {
    this.jobs.define(SYNC_JOB, () => this.scheduledSync());
    const c = await this.stored().catch(() => DEFAULT);
    await this.jobs
      .schedule(SYNC_JOB, c.enabled ? c.scheduleCron : null)
      .catch((e: Error) => this.logger.warn(`SIS sync schedule not applied: ${e.message}`));
  }

  private async headers(c: StoredConnector): Promise<Record<string, string>> {
    if (c.auth.type === 'API_KEY' && c.auth.keySealed) return { [c.auth.header]: this.box.open(c.auth.keySealed) };
    if (c.auth.type === 'OAUTH2' && c.auth.secretSealed) {
      const tokenUrl = await assertSafeUrl(c.auth.tokenUrl, this.env.NODE_ENV === 'production');
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: c.auth.clientId,
          client_secret: this.box.open(c.auth.secretSealed),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw Errors.badRequest('SIS_AUTH_FAILED', `The SIS rejected the credentials (${res.status}).`);
      const token = ((await res.json()) as { access_token?: string }).access_token;
      if (!token) throw Errors.badRequest('SIS_AUTH_FAILED', 'The SIS token response had no access_token.');
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  /** Fetches all students from the SIS (bounded to 100 pages / 100k rows) and maps them to import rows. */
  async fetchAll(maxPages = 1000): Promise<Array<Record<string, unknown>>> {
    const c = await this.stored();
    if (!c.baseUrl) throw Errors.badRequest('SIS_NOT_CONFIGURED', 'Configure the SIS URL first.');
    const base = await assertSafeUrl(c.baseUrl, this.env.NODE_ENV === 'production');
    const headers = { Accept: 'application/json', ...(await this.headers(c)) };
    const rows: Array<Record<string, unknown>> = [];
    let page = 1;
    let cursor: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(c.studentsPath, base);
      if (url.host !== base.host)
        throw Errors.badRequest('INVALID_URL', 'The students path must stay on the SIS host.');
      if (c.pagination === 'PAGE') url.searchParams.set('page', String(page));
      if (c.pagination === 'CURSOR' && cursor) url.searchParams.set('cursor', cursor);
      const res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw Errors.badRequest('SIS_REQUEST_FAILED', `The SIS answered ${res.status}.`);
      const body = (await res.json()) as unknown;
      const items = (c.itemsPath ? get(body, c.itemsPath) : body) as unknown[];
      if (!Array.isArray(items)) throw Errors.badRequest('SIS_BAD_RESPONSE', `No array found at "${c.itemsPath}".`);
      for (const item of items) {
        rows.push(Object.fromEntries(Object.entries(c.mapping).map(([field, path]) => [field, get(item, path)])));
        if (rows.length > 100_000)
          throw Errors.badRequest('TOO_MANY_ROWS', 'The SIS returned more than 100 000 students.');
      }
      if (c.pagination === 'NONE' || items.length === 0) break;
      if (c.pagination === 'PAGE') page++;
      else {
        cursor = get(body, 'nextCursor') as string | undefined;
        if (!cursor) break;
      }
    }
    return rows;
  }

  async test() {
    try {
      const rows = await this.fetchAll(1);
      return {
        ok: true,
        sampleCount: rows.length,
        message: rows.length ? 'Connected. Students were returned.' : 'Connected, but no students were returned.',
      };
    } catch (e) {
      return { ok: false, sampleCount: 0, message: (e as Error).message };
    }
  }

  async sync(actorId: string | null) {
    const rows = await this.fetchAll();
    const dto = await this.directory.uploadRows(rows, actorId);
    const c = await this.stored();
    await this.prisma.setting.update({
      where: { key: CONNECTOR_KEY },
      data: { value: { ...c, lastSyncAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue },
    });
    return dto;
  }
}

@Controller()
export class DirectoryController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly connector: ConnectorService,
  ) {}

  @Contract('directory.upload')
  upload(@ContractInput() input: In<'directory.upload'>, @Req() req: LpRequest) {
    return this.directory.upload(input.query.kind, input.query.fileName, input.body, req.admin!.id);
  }

  @Contract('directory.list')
  list() {
    return this.directory.list();
  }

  @Contract('directory.get')
  get(@ContractInput() input: In<'directory.get'>) {
    return this.directory.dto(input.params.id);
  }

  @Contract('directory.mapping')
  mapping(@ContractInput() input: In<'directory.mapping'>) {
    return this.directory.remap(input.params.id, input.body.mapping);
  }

  @Contract('directory.commit')
  commit(@ContractInput() input: In<'directory.commit'>) {
    return this.directory.commit(input.params.id, input.body.deactivateMissing);
  }

  @Contract('directory.rollback')
  rollback(@ContractInput() input: In<'directory.rollback'>) {
    return this.directory.rollback(input.params.id);
  }

  @Contract('directory.errors')
  async errors(@ContractInput() input: In<'directory.errors'>, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="import-${input.params.id}-problems.csv"`);
    return this.directory.errorsCsv(input.params.id);
  }

  @Contract('directory.template')
  template(@ContractInput() input: In<'directory.template'>, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="labpass-${input.query.kind.toLowerCase()}-template.csv"`);
    return this.directory.template(input.query.kind);
  }

  @Contract('directory.connectorGet')
  connectorGet() {
    return this.connector.view();
  }

  @Contract('directory.connectorUpdate')
  connectorUpdate(@ContractInput() input: In<'directory.connectorUpdate'>, @Req() req: LpRequest) {
    return this.connector.update(input.body, req.admin!.id);
  }

  @Contract('directory.connectorTest')
  connectorTest() {
    return this.connector.test();
  }

  @Contract('directory.connectorSync')
  connectorSync(@Req() req: LpRequest) {
    return this.connector.sync(req.admin!.id);
  }
}

@Module({
  controllers: [DirectoryController],
  providers: [DirectoryService, ConnectorService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
