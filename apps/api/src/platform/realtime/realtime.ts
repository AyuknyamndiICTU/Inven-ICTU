import type { AdminEventName, AdminEventPayload, KioskEventName, KioskEventPayload } from '@labpass/contracts';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { API_ENV, type ApiEnv } from '../../config/env';
import { ADMIN_COOKIE, AdminSessionService } from '../auth/admin-session.service';
import { sha256Hex } from '../crypto/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CHANNEL = 'lp:rt';
type Ns = 'admin' | 'kiosk';

/**
 * Real-time fan-out. Any process (API or worker) publishes to Redis; every API process emits to its connected
 * sockets. Payloads follow `adminEvents` / `kioskEvents` in the contract.
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly servers = new Map<Ns, Namespace>();
  private readonly logger = new Logger('Realtime');

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    const sub = this.redis.sub();
    await sub.subscribe(CHANNEL);
    sub.on('message', (channel, raw) => {
      if (channel !== CHANNEL) return;
      try {
        const m = JSON.parse(raw) as { ns: Ns; room: string | null; event: string; payload: unknown };
        const server = this.servers.get(m.ns);
        if (!server) return;
        (m.room ? server.to(m.room) : server).emit(m.event, m.payload);
      } catch (e) {
        this.logger.warn(`bad realtime message: ${(e as Error).message}`);
      }
    });
  }

  attach(ns: Ns, server: Namespace) {
    this.servers.set(ns, server);
  }

  async toAdmins<E extends AdminEventName>(event: E, payload: AdminEventPayload<E>) {
    await this.redis.client.publish(CHANNEL, JSON.stringify({ ns: 'admin', room: null, event, payload }));
  }

  /** `kioskId = null` broadcasts to every kiosk. */
  async toKiosk<E extends KioskEventName>(kioskId: string | null, event: E, payload: KioskEventPayload<E>) {
    await this.redis.client.publish(
      CHANNEL,
      JSON.stringify({ ns: 'kiosk', room: kioskId ? `kiosk:${kioskId}` : null, event, payload }),
    );
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

@WebSocketGateway({ namespace: '/admin', cors: { origin: true, credentials: true } })
export class AdminGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly sessions: AdminSessionService,
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach('admin', server);
  }

  async handleConnection(client: Socket) {
    const origin = client.handshake.headers.origin;
    if (origin && !this.env.ADMIN_ORIGINS.includes(origin)) return client.disconnect(true);
    const session = await this.sessions.get(parseCookies(client.handshake.headers.cookie)[ADMIN_COOKIE]);
    const user =
      session?.stage === 'AUTH' ? await this.prisma.adminUser.findUnique({ where: { id: session.userId } }) : null;
    if (!user?.active) return client.disconnect(true);
    await client.join(`admin:${user.id}`);
  }
}

@WebSocketGateway({ namespace: '/kiosk', cors: { origin: false } })
export class KioskGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach('kiosk', server);
  }

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token.length > 2048) return client.disconnect(true);
    const kiosk = await this.prisma.kiosk.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!kiosk || kiosk.status !== 'ACTIVE') return client.disconnect(true);
    await client.join(`kiosk:${kiosk.id}`);
    client.emit('ready', { kioskId: kiosk.id });
  }
}
