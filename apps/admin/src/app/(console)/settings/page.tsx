'use client';

import type { Settings } from '@labpass/contracts/client';
import { Button, Input, StatusCapsule, useToast } from '@labpass/ui';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Loadable, PageHeader, Panel, Select, Toggle } from '@/components/page';
import { problemText, useApi, useApiMutation } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const POLICIES = ['PIN_OR_ASSISTANT', 'OTP', 'ASSISTANT', 'OPEN'] as const;

function SettingsForm({ initial }: { initial: Settings }) {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [s, setS] = useState<Settings>(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setS(initial), [initial]);
  const save = useApiMutation('settings.update', {
    invalidates: ['settings.get'],
    onSuccess: () => toast.show({ title: t('admin.ui.saved'), tone: 'success' }),
  });
  const editable = can('LAB_ADMIN');
  const superAdmin = can('SUPER_ADMIN');
  const up = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const changed = Object.fromEntries(
      Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k as keyof Settings])),
    );
    if (!Object.keys(changed).length) return;
    save.mutate({ body: changed }, { onError: (err) => setError(problemText(err, t('admin.ui.error'))) });
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <fieldset disabled={!editable} className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('admin.settings.labels')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['signIn', 'signOut'] as const).map((k) =>
              (['en', 'fr'] as const).map((l) => (
                <Input
                  key={`${k}-${l}`}
                  label={`${t(`admin.settings.${k}`)} (${l.toUpperCase()})`}
                  maxLength={40}
                  required
                  value={s.labels[k][l]}
                  onChange={(e) => up('labels', { ...s.labels, [k]: { ...s.labels[k], [l]: e.target.value } })}
                />
              )),
            )}
          </div>
        </Panel>
        <Panel title={t('admin.settings.manualEntry')}>
          <div role="radiogroup" aria-label={t('admin.settings.manualEntry')} className="grid gap-2">
            {POLICIES.map((p) => {
              const locked = p === 'OPEN' && !superAdmin && s.manualEntryPolicy !== 'OPEN';
              return (
                <label
                  key={p}
                  className={`flex items-center gap-3 rounded-field border p-3 text-sm ${s.manualEntryPolicy === p ? 'border-accent' : 'border-line'} ${locked ? 'opacity-50' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="policy"
                    checked={s.manualEntryPolicy === p}
                    disabled={locked}
                    onChange={() => up('manualEntryPolicy', p)}
                  />
                  <span className="font-medium">{t(`admin.settings.${p}`)}</span>
                </label>
              );
            })}
          </div>
          {s.manualEntryPolicy === 'OPEN' && (
            <p role="alert" className="mt-3 flex gap-2 text-sm font-semibold text-out-text">
              <AlertTriangle size={18} aria-hidden className="flex-none" /> {t('admin.settings.openWarning')}
            </p>
          )}
        </Panel>
        <Panel title={t('admin.settings.general')}>
          <div className="grid gap-4">
            <Select
              label={t('admin.settings.loanDue')}
              value={s.loanDue.mode}
              onChange={(v) => up('loanDue', { ...s.loanDue, mode: v as 'LAB_CLOSING' | 'HOURS' })}
              options={(['LAB_CLOSING', 'HOURS'] as const).map((m) => ({ value: m, label: t(`admin.settings.${m}`) }))}
            />
            {s.loanDue.mode === 'LAB_CLOSING' ? (
              <Input
                label={t('admin.settings.closingTime')}
                type="time"
                className="max-w-40"
                value={s.loanDue.labClosingTime}
                onChange={(e) => up('loanDue', { ...s.loanDue, labClosingTime: e.target.value })}
              />
            ) : (
              <Input
                label={t('admin.settings.hours')}
                type="number"
                min={1}
                max={720}
                className="max-w-40"
                value={s.loanDue.hours}
                onChange={(e) => up('loanDue', { ...s.loanDue, hours: Number(e.target.value) })}
              />
            )}
            <Toggle
              label={`${t('admin.settings.maxItems')}: ${t('admin.settings.unlimited')}`}
              checked={s.maxItemsPerStudent === null}
              onChange={(v) => up('maxItemsPerStudent', v ? null : 3)}
            />
            {s.maxItemsPerStudent !== null && (
              <Input
                label={t('admin.settings.maxItems')}
                type="number"
                min={1}
                max={1000}
                className="max-w-40"
                value={s.maxItemsPerStudent}
                onChange={(e) => up('maxItemsPerStudent', Number(e.target.value))}
              />
            )}
            <Toggle
              label={t('admin.settings.blockOverdue')}
              checked={s.blockWhenOverdue}
              onChange={(v) => up('blockWhenOverdue', v)}
            />
            <Select
              label={t('admin.settings.overdueReminders')}
              value={s.overdueReminders}
              onChange={(v) => up('overdueReminders', v as Settings['overdueReminders'])}
              options={(['PUSH', 'EMAIL', 'SMS', 'OFF'] as const).map((v) => ({
                value: v,
                label: v === 'OFF' ? t('admin.settings.off') : t(`admin.alerts.${v}`),
              }))}
            />
          </div>
        </Panel>
        <Panel title={t('admin.settings.kiosk')}>
          <div className="grid gap-4">
            <Input
              label={t('admin.settings.timeout')}
              type="number"
              min={15}
              max={600}
              className="max-w-40"
              value={s.kiosk.inactivityTimeoutSec}
              onChange={(e) => up('kiosk', { ...s.kiosk, inactivityTimeoutSec: Number(e.target.value) })}
            />
            <Select
              label={t('admin.settings.motion')}
              value={s.kiosk.motionLevel}
              onChange={(v) => up('kiosk', { ...s.kiosk, motionLevel: v as Settings['kiosk']['motionLevel'] })}
              options={(['full', 'reduced', 'minimal'] as const).map((m) => ({
                value: m,
                label: t(`admin.settings.${m}`),
              }))}
            />
            <Toggle
              label={t('admin.settings.sound')}
              checked={s.kiosk.soundCues}
              onChange={(v) => up('kiosk', { ...s.kiosk, soundCues: v })}
            />
            <Input
              label={t('admin.settings.offlineHours')}
              type="number"
              min={0}
              max={72}
              className="max-w-40"
              value={s.offlineMaxHours}
              onChange={(e) => up('offlineMaxHours', Number(e.target.value))}
            />
          </div>
        </Panel>
        <Panel title={t('admin.settings.cardAuth')}>
          <div className="grid gap-4">
            <Select
              label={t('admin.settings.cardAuth')}
              disabled={!superAdmin}
              value={s.cardAuthMode}
              onChange={(v) => up('cardAuthMode', v as Settings['cardAuthMode'])}
              options={(['UID', 'DESFIRE_PREFERRED', 'DESFIRE_REQUIRED'] as const).map((m) => ({
                value: m,
                label: t(`admin.settings.${m}`),
              }))}
            />
            <Input
              label={t('admin.settings.retention')}
              type="number"
              min={6}
              max={120}
              className="max-w-40"
              disabled={!superAdmin}
              value={s.retentionMonths}
              onChange={(e) => up('retentionMonths', Number(e.target.value))}
            />
            <Input
              label={t('admin.settings.minVersion')}
              mono
              className="max-w-40"
              disabled={!superAdmin}
              value={s.minSupportedAppVersion}
              onChange={(e) => up('minSupportedAppVersion', e.target.value)}
            />
            {!superAdmin && <p className="text-xs text-text-muted">{t('admin.settings.superOnly')}</p>}
          </div>
        </Panel>
      </fieldset>
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" loading={save.isPending}>
            {t('admin.ui.save')}
          </Button>
          {error && <StatusCapsule tone="out">{error}</StatusCapsule>}
        </div>
      )}
    </form>
  );
}

function AssistantPin() {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useSession();
  const [pin, setPin] = useState('');
  const save = useApiMutation('adminUsers.assistantPin', {
    invalidates: ['auth.me'],
    onSuccess: () => (setPin(''), toast.show({ title: t('admin.settings.pinSaved'), tone: 'success' })),
  });
  return (
    <Panel title={t('admin.settings.assistantPin')}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { body: { pin } },
            { onError: (err) => toast.show({ title: problemText(err, t('admin.ui.error')), tone: 'error' }) },
          );
        }}
      >
        <Input
          label={t('admin.settings.assistantPin')}
          hideLabel
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          mono
          pattern="\d{4,6}"
          maxLength={6}
          className="w-40"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          hint={t('admin.settings.assistantPinHint')}
        />
        <Button type="submit" variant="secondary" loading={save.isPending} disabled={pin.length < 4}>
          {t('admin.ui.save')}
        </Button>
        {user.hasAssistantPin && <StatusCapsule tone="ok">{t('admin.students.pinSet')}</StatusCapsule>}
      </form>
    </Panel>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const settings = useApi('settings.get');
  return (
    <>
      <PageHeader title={t('admin.settings.title')} />
      <div className="grid gap-4">
        <Loadable query={settings} rows={8}>
          {(s) => <SettingsForm initial={s} />}
        </Loadable>
        {can('LAB_ASSISTANT') && <AssistantPin />}
      </div>
    </>
  );
}
