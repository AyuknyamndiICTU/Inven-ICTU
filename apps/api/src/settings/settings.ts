import { type AdminRole, type KioskConfig, Settings, type Settings as SettingsT } from '@labpass/contracts';
import { Controller, Injectable, Module, type OnModuleInit, Req } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Contract } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { EventBus, OutboxService } from '../platform/outbox/outbox';
import { RealtimeService } from '../platform/realtime/realtime';
import { PrismaService } from '../platform/prisma/prisma.service';

const CACHE_MS = 5_000;

/** Settings that only a SUPER_ADMIN may change (ARCH §7, decision Q9). */
const SUPER_ADMIN_KEYS = new Set<keyof SettingsT>([
  'cardAuthMode',
  'androidApk',
  'minSupportedAppVersion',
  'retentionMonths',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch))
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function kioskConfigOf(s: SettingsT): KioskConfig {
  return {
    labels: s.labels,
    manualEntryPolicy: s.manualEntryPolicy,
    kiosk: s.kiosk,
    cardAuthMode: s.cardAuthMode,
    offlineMaxHours: s.offlineMaxHours,
    maxItemsPerStudent: s.maxItemsPerStudent,
  };
}

@Injectable()
export class SettingsService {
  private cache?: { value: SettingsT; at: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async get(): Promise<SettingsT> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.setting.findMany();
    const value = Settings.parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate() {
    this.cache = undefined;
  }

  /** Applies a partial update (deep-merged, then validated as a whole). Only keys present in `rawPatch` are written. */
  async update(rawPatch: Record<string, unknown>, actor: { id: string; role: AdminRole }): Promise<SettingsT> {
    this.invalidate();
    const current = await this.get();
    const next = Settings.parse(deepMerge(current, rawPatch));
    const changed = (Object.keys(next) as Array<keyof SettingsT>).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]),
    );
    if (actor.role !== 'SUPER_ADMIN') {
      const restricted = changed.filter((k) => SUPER_ADMIN_KEYS.has(k));
      if (restricted.length)
        throw Errors.forbidden('ROLE_REQUIRED', `Only a SUPER_ADMIN can change: ${restricted.join(', ')}.`, {
          requiredRole: 'SUPER_ADMIN',
        });
      if (next.manualEntryPolicy === 'OPEN' && current.manualEntryPolicy !== 'OPEN') {
        throw Errors.forbidden('ROLE_REQUIRED', 'Only a SUPER_ADMIN can allow unverified matricule entry (OPEN).', {
          requiredRole: 'SUPER_ADMIN',
        });
      }
    }
    if (changed.length === 0) return current;
    await this.prisma.tx(async (tx) => {
      for (const key of changed) {
        const value = next[key] as unknown as Prisma.InputJsonValue;
        await tx.setting.upsert({
          where: { key },
          update: { value, updatedById: actor.id },
          create: { key, value, updatedById: actor.id },
        });
      }
      await this.outbox.add(tx, 'SettingsChanged', { keys: changed, kioskConfig: kioskConfigOf(next) });
    });
    this.invalidate();
    return next;
  }
}

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Contract('settings.get')
  get() {
    return this.settings.get();
  }

  @Contract('settings.update')
  async update(@Req() req: LpRequest) {
    // Validate shape against the contract first (unknown keys / wrong types → 400), then merge only the sent keys.
    const parsed = Settings.partial().safeParse(req.body ?? {});
    if (!parsed.success)
      throw Errors.validation(
        parsed.error.issues.map((i) => ({ path: `body.${i.path.join('.')}`, message: i.message })),
      );
    return this.settings.update((req.body ?? {}) as Record<string, unknown>, req.admin!);
  }
}

/** Pushes the kiosk-relevant part of committed settings changes to every kiosk (contract event config.changed). */
@Injectable()
export class SettingsEvents implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.bus.onDirect(['SettingsChanged'], async (e) => {
      this.settings.invalidate();
      await this.realtime.toKiosk(null, 'config.changed', (e.payload as { kioskConfig: KioskConfig }).kioskConfig);
    });
  }
}

@Module({ controllers: [SettingsController], providers: [SettingsService, SettingsEvents], exports: [SettingsService] })
export class SettingsModule {}
