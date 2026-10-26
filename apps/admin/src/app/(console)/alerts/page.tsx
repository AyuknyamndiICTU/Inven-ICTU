'use client';

import type { AdminUser } from '@labpass/contracts';

type NotificationPrefs = AdminUser['notificationPrefs'];
import { Button, Input, StatusCapsule, Table, TBody, Td, Th, THead, Tr, useToast } from '@labpass/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Loadable, PageHeader, Pager, Panel, Select, Toggle } from '@/components/page';
import { api, problemText, useApi, useApiMutation } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function PhoneVerify({
  channel,
  masked,
  verified,
}: {
  channel: 'SMS' | 'WHATSAPP';
  masked: string | null;
  verified: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(problemText(e, t('admin.ui.error')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2 rounded-field border border-line p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{t(`admin.alerts.${channel}`)}</span>
        {verified ? (
          <StatusCapsule tone="ok">
            {t('admin.alerts.verified')} · {masked}
          </StatusCapsule>
        ) : (
          <span className="text-xs text-text-muted">{t('admin.alerts.notVerified')}</span>
        )}
      </div>
      {!sentTo ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(async () =>
              setSentTo((await api.call('adminUsers.verifyPhoneStart', { body: { channel, phone } })).destination),
            );
          }}
        >
          <Input
            className="min-w-48 flex-1"
            label={t('admin.alerts.phone')}
            type="tel"
            placeholder="+237 6XX XX XX XX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <Button type="submit" variant="secondary" loading={busy}>
            {verified ? t('admin.alerts.verify') : t('admin.alerts.sendCode')}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(async () => {
              await api.call('adminUsers.verifyPhoneConfirm', { body: { channel, code } });
              await qc.invalidateQueries({ queryKey: ['auth.me'] });
              setSentTo(null);
              setCode('');
              toast.show({ title: t('admin.alerts.verified'), tone: 'success' });
            });
          }}
        >
          <Input
            className="w-40"
            label={`${t('admin.alerts.code')} (${sentTo})`}
            mono
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Button type="submit" loading={busy} disabled={code.length !== 6}>
            {t('admin.login.verify')}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-out-text">
          {error}
        </p>
      )}
    </div>
  );
}

function MyChannels() {
  const { t } = useI18n();
  const { user } = useSession();
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs>(user.notificationPrefs);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation('adminUsers.prefs', {
    invalidates: ['auth.me'],
    onSuccess: () => toast.show({ title: t('admin.ui.saved'), tone: 'success' }),
  });
  const test = useApiMutation('notifications.test', { invalidates: ['notifications.log'] });
  useEffect(() => setPrefs(user.notificationPrefs), [user.notificationPrefs]);
  const set = <K extends keyof NotificationPrefs>(k: K, v: NotificationPrefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  return (
    <Panel title={t('admin.alerts.myChannels')}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <Toggle
            label={t('admin.alerts.EMAIL')}
            hint={user.email}
            checked={prefs.email}
            onChange={(v) => set('email', v)}
          />
          <Toggle
            label={t('admin.alerts.SMS')}
            hint={user.phoneVerified ? user.phoneMasked : t('admin.alerts.notVerified')}
            checked={prefs.sms}
            disabled={!user.phoneVerified}
            onChange={(v) => set('sms', v)}
          />
          <Toggle
            label={t('admin.alerts.WHATSAPP')}
            hint={user.whatsappVerified ? user.whatsappMasked : t('admin.alerts.notVerified')}
            checked={prefs.whatsapp}
            disabled={!user.whatsappVerified}
            onChange={(v) => set('whatsapp', v)}
          />
          <hr className="border-line" />
          <Toggle label={t('admin.alerts.lowStock')} checked={prefs.lowStock} onChange={(v) => set('lowStock', v)} />
          <Toggle
            label={t('admin.alerts.outOfStock')}
            checked={prefs.outOfStock}
            onChange={(v) => set('outOfStock', v)}
          />
          <Toggle
            label={t('admin.alerts.credentialRequests')}
            checked={prefs.credentialRequests}
            onChange={(v) => set('credentialRequests', v)}
          />
          <Select
            label={t('admin.alerts.language')}
            value={prefs.locale}
            onChange={(v) => set('locale', v as 'en' | 'fr')}
            options={[
              { value: 'en', label: 'English' },
              { value: 'fr', label: 'Français' },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              loading={save.isPending}
              onClick={() =>
                save.mutate({ body: prefs }, { onError: (e) => setError(problemText(e, t('admin.ui.error'))) })
              }
            >
              {t('admin.ui.save')}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm font-semibold text-out-text">
              {error}
            </p>
          )}
        </div>
        <div className="grid content-start gap-3">
          <PhoneVerify channel="SMS" masked={user.phoneMasked} verified={user.phoneVerified} />
          <PhoneVerify channel="WHATSAPP" masked={user.whatsappMasked} verified={user.whatsappVerified} />
          <div className="flex flex-wrap gap-2">
            {(['EMAIL', 'SMS', 'WHATSAPP'] as const).map((c) => (
              <Button
                key={c}
                size="sm"
                variant="secondary"
                icon={<Send size={14} />}
                loading={test.isPending && test.variables?.body.channel === c}
                onClick={() =>
                  test.mutate(
                    { body: { channel: c } },
                    {
                      onSuccess: (r) =>
                        toast.show({
                          title: `${t('admin.alerts.sendTest')} · ${t(`admin.alerts.${c}`)}`,
                          description: r.detail,
                          tone: r.status === 'QUEUED' ? 'success' : 'info',
                        }),
                      onError: (e) => toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' }),
                    },
                  )
                }
              >
                {t('admin.alerts.sendTest')} · {t(`admin.alerts.${c}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Rules() {
  const { t } = useI18n();
  const toast = useToast();
  const settings = useApi('settings.get');
  const [form, setForm] = useState({ threshold: 2, quietEnabled: false, start: '21:00', end: '07:00', digest: 0 });
  useEffect(() => {
    const s = settings.data;
    if (s)
      setForm({
        threshold: s.globalLowStockThreshold,
        quietEnabled: s.quietHours.enabled,
        start: s.quietHours.start,
        end: s.quietHours.end,
        digest: s.alertDigestMinutes,
      });
  }, [settings.data]);
  const save = useApiMutation('settings.update', {
    invalidates: ['settings.get', 'equipment.list', 'dashboard.summary'],
    onSuccess: () => toast.show({ title: t('admin.ui.saved'), tone: 'success' }),
  });
  return (
    <Panel title={t('admin.alerts.globalThreshold')}>
      <Loadable query={settings} rows={3}>
        {() => (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                {
                  body: {
                    globalLowStockThreshold: form.threshold,
                    quietHours: { enabled: form.quietEnabled, start: form.start, end: form.end },
                    alertDigestMinutes: form.digest,
                  },
                },
                { onError: (err) => toast.show({ title: problemText(err, t('admin.ui.error')), tone: 'error' }) },
              );
            }}
          >
            <Input
              label={t('admin.alerts.globalThreshold')}
              hint={t('admin.alerts.globalHint')}
              type="number"
              min={0}
              className="max-w-xs"
              value={form.threshold}
              onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))}
            />
            <Toggle
              label={t('admin.alerts.quietHours')}
              hint={t('admin.alerts.quietHint')}
              checked={form.quietEnabled}
              onChange={(v) => setForm((f) => ({ ...f, quietEnabled: v }))}
            />
            {form.quietEnabled && (
              <div className="flex gap-3">
                <Input
                  label={t('admin.alerts.from')}
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                />
                <Input
                  label={t('admin.alerts.to')}
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                />
              </div>
            )}
            <Input
              label={t('admin.alerts.digest')}
              type="number"
              min={0}
              max={120}
              className="max-w-xs"
              value={form.digest}
              onChange={(e) => setForm((f) => ({ ...f, digest: Number(e.target.value) }))}
            />
            <div>
              <Button type="submit" loading={save.isPending}>
                {t('admin.ui.save')}
              </Button>
            </div>
          </form>
        )}
      </Loadable>
    </Panel>
  );
}

function PerItem() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useApi('equipment.list', { query: { pageSize: 200 } });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Object.keys(edits).length;
  const saveAll = async () => {
    setBusy(true);
    try {
      for (const [id, v] of Object.entries(edits))
        await api.call('equipment.update', {
          params: { id },
          body: { lowStockThreshold: v === '' ? null : Number(v) },
        });
      setEdits({});
      await qc.invalidateQueries({ queryKey: ['equipment.list'] });
      toast.show({ title: t('admin.ui.saved'), tone: 'success' });
    } catch (e) {
      toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title={t('admin.alerts.perItem')}
      actions={
        <Button size="sm" disabled={!dirty} loading={busy} onClick={() => void saveAll()}>
          {t('admin.ui.save')} {dirty ? `(${dirty})` : ''}
        </Button>
      }
    >
      <Loadable query={list} rows={6}>
        {(p) => (
          <div className="max-h-[420px] overflow-auto">
            <Table caption={t('admin.alerts.perItem')}>
              <THead>
                <Tr>
                  <Th>{t('admin.inventory.name')}</Th>
                  <Th numeric>{t('admin.inventory.available')}</Th>
                  <Th>{t('admin.inventory.threshold')}</Th>
                </Tr>
              </THead>
              <TBody>
                {p.items.map((e) => (
                  <Tr key={e.id}>
                    <Td className="text-sm">{e.name}</Td>
                    <Td numeric>{e.availableQuantity}</Td>
                    <Td>
                      <input
                        className="lp-num-input"
                        type="number"
                        min={0}
                        aria-label={`${t('admin.inventory.threshold')} · ${e.name}`}
                        placeholder={`${e.effectiveThreshold} (global)`}
                        value={edits[e.id] ?? (e.lowStockThreshold === null ? '' : String(e.lowStockThreshold))}
                        onChange={(ev) => setEdits((s) => ({ ...s, [e.id]: ev.target.value }))}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Loadable>
    </Panel>
  );
}

function Providers() {
  const { t } = useI18n();
  const toast = useToast();
  const channels = useApi('notifications.channels');
  const [sms, setSms] = useState({ provider: 'MOCK' as 'MOCK' | 'HTTP', endpoint: '', sender: '', apiKey: '' });
  const [wa, setWa] = useState({ enabled: false, phoneNumberId: '', accessToken: '', appSecret: '', verifyToken: '' });
  const save = useApiMutation('notifications.providers', {
    invalidates: ['notifications.channels'],
    onSuccess: () => toast.show({ title: t('admin.ui.saved'), tone: 'success' }),
  });
  const opt = (v: string) => v || undefined;
  return (
    <Panel title={t('admin.alerts.providers')}>
      <Loadable query={channels} rows={2}>
        {(cs) => (
          <div className="mb-4 flex flex-wrap gap-2">
            {cs.map((c) => (
              <StatusCapsule key={c.channel} tone={c.configured ? 'ok' : 'neutral'}>
                {t(`admin.alerts.${c.channel}`)} ·{' '}
                {c.configured ? t('admin.alerts.configured') : t('admin.alerts.notConfigured')}
              </StatusCapsule>
            ))}
          </div>
        )}
      </Loadable>
      <form
        className="grid gap-6 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            {
              body: {
                sms: {
                  provider: sms.provider,
                  endpoint: opt(sms.endpoint),
                  sender: opt(sms.sender),
                  apiKey: opt(sms.apiKey),
                },
                whatsapp: {
                  enabled: wa.enabled,
                  phoneNumberId: opt(wa.phoneNumberId),
                  accessToken: opt(wa.accessToken),
                  appSecret: opt(wa.appSecret),
                  verifyToken: opt(wa.verifyToken),
                },
              },
            },
            { onError: (err) => toast.show({ title: problemText(err, t('admin.ui.error')), tone: 'error' }) },
          );
        }}
      >
        <fieldset className="grid content-start gap-3">
          <legend className="mb-2 text-sm font-semibold">{t('admin.alerts.smsProvider')}</legend>
          <Select
            label={t('admin.alerts.smsProvider')}
            hideLabel
            value={sms.provider}
            onChange={(v) => setSms((s) => ({ ...s, provider: v as 'MOCK' | 'HTTP' }))}
            options={(['MOCK', 'HTTP'] as const).map((v) => ({ value: v, label: t(`admin.alerts.${v}`) }))}
          />
          {sms.provider === 'HTTP' && (
            <>
              <Input
                label={t('admin.alerts.endpoint')}
                type="url"
                value={sms.endpoint}
                onChange={(e) => setSms((s) => ({ ...s, endpoint: e.target.value }))}
              />
              <Input
                label={t('admin.alerts.sender')}
                value={sms.sender}
                onChange={(e) => setSms((s) => ({ ...s, sender: e.target.value }))}
              />
              <Input
                label={t('admin.alerts.apiKey')}
                type="password"
                autoComplete="new-password"
                hint={t('admin.alerts.secretSaved')}
                value={sms.apiKey}
                onChange={(e) => setSms((s) => ({ ...s, apiKey: e.target.value }))}
              />
            </>
          )}
        </fieldset>
        <fieldset className="grid content-start gap-3">
          <legend className="mb-2 text-sm font-semibold">WhatsApp Cloud API</legend>
          <Toggle
            label={t('admin.alerts.whatsappEnabled')}
            checked={wa.enabled}
            onChange={(v) => setWa((s) => ({ ...s, enabled: v }))}
          />
          <Input
            label={t('admin.alerts.phoneNumberId')}
            autoComplete="off"
            value={wa.phoneNumberId}
            onChange={(e) => setWa((s) => ({ ...s, phoneNumberId: e.target.value }))}
          />
          {(['accessToken', 'appSecret', 'verifyToken'] as const).map((k) => (
            <Input
              key={k}
              label={t(`admin.alerts.${k}`)}
              type="password"
              autoComplete="new-password"
              hint={t('admin.alerts.secretSaved')}
              value={wa[k]}
              onChange={(e) => setWa((s) => ({ ...s, [k]: e.target.value }))}
            />
          ))}
        </fieldset>
        <div className="md:col-span-2">
          <Button type="submit" loading={save.isPending}>
            {t('admin.ui.save')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Logs() {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const log = useApi('notifications.log', { query: { page, pageSize: 20 } }, { placeholderData: (p) => p });
  const occ = useApi('alerts.occurrences');
  const TONE = { QUEUED: 'neutral', SENT: 'signal', DELIVERED: 'ok', FAILED: 'low', DEAD: 'out' } as const;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Panel title={t('admin.alerts.deliveryLog')}>
        <Loadable query={log} rows={6}>
          {(p) => (
            <>
              <Table caption={t('admin.alerts.deliveryLog')}>
                <THead>
                  <Tr>
                    <Th>{t('admin.inventory.when')}</Th>
                    <Th>{t('admin.alerts.channel')}</Th>
                    <Th>{t('admin.alerts.recipient')}</Th>
                    <Th>{t('admin.alerts.template')}</Th>
                    <Th>{t('admin.alerts.status')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {p.items.map((l) => (
                    <Tr key={l.id}>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt, locale)}</Td>
                      <Td className="text-sm">{t(`admin.alerts.${l.channel}`)}</Td>
                      <Td className="font-mono text-xs">{l.recipientMasked}</Td>
                      <Td className="font-mono text-xs">{l.template}</Td>
                      <Td>
                        <span title={l.error ?? undefined}>
                          <StatusCapsule tone={TONE[l.status]}>{l.status}</StatusCapsule>
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pager page={p.page} pageSize={p.pageSize} total={p.total} onPage={setPage} />
            </>
          )}
        </Loadable>
      </Panel>
      <Panel title={t('admin.alerts.occurrences')}>
        <Loadable
          query={occ}
          rows={5}
          empty={(o) => (o.length ? null : <p className="text-sm text-text-muted">{t('admin.dashboard.allGood')}</p>)}
        >
          {(list) => (
            <ul className="grid gap-2">
              {list.slice(0, 30).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {o.equipmentName} <span className="text-xs text-text-muted">· {o.availableAtFire}</span>
                  </span>
                  <span className="flex items-center gap-2 whitespace-nowrap text-xs text-text-muted">
                    {relativeTime(o.firedAt, locale)}
                    <StatusCapsule tone={o.resolvedAt ? 'neutral' : o.severity === 'OUT' ? 'out' : 'low'}>
                      {o.resolvedAt
                        ? t('admin.alerts.resolved')
                        : o.severity === 'OUT'
                          ? t('admin.alerts.outOfStock')
                          : t('admin.alerts.lowStock')}
                    </StatusCapsule>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Loadable>
      </Panel>
    </div>
  );
}

export default function AlertsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <>
      <PageHeader title={t('admin.alerts.title')} />
      <div className="grid gap-4">
        <MyChannels />
        {can('LAB_ADMIN') && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Rules />
              <PerItem />
            </div>
            {can('SUPER_ADMIN') && <Providers />}
            <Logs />
          </>
        )}
        {!can('LAB_ADMIN') && (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <CheckCircle2 size={16} aria-hidden /> {t('admin.ui.lockedHint')}
          </p>
        )}
      </div>
    </>
  );
}
