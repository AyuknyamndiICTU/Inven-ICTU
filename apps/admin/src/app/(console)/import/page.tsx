'use client';

import type { DirectoryImportDto } from '@labpass/contracts';
import {
  Button,
  Dialog,
  Input,
  KpiCounter,
  StatusCapsule,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@labpass/ui';
import { Download, PlugZap, RefreshCw, Undo2, Upload } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Loadable, PageHeader, Panel, RoleGate, Select, Toggle } from '@/components/page';
import { api, downloadCsv, problemText, useApi, useApiMutation } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const FIELDS = {
  STUDENTS: [
    'matricule',
    'first_name',
    'last_name',
    'date_of_birth',
    'email',
    'phone',
    'program',
    'level',
    'status',
    'card_uid',
    'photo_url',
  ],
  CARD_BATCH: ['card_uid', 'matricule', 'batch_id', 'printed_at'],
} as const;
const STATUS_TONE = {
  PREVIEW: 'signal',
  COMMITTING: 'low',
  COMMITTED: 'ok',
  ROLLED_BACK: 'neutral',
  FAILED: 'out',
} as const;

function contentTypeOf(f: File) {
  if (/\.xlsx$/i.test(f.name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'text/csv';
}

function Preview({ imp, onChange }: { imp: DirectoryImportDto; onChange: (d: DirectoryImportDto) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [deactivate, setDeactivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inv = ['directory.list', 'students.list', 'dashboard.summary'] as const;
  const remap = useApiMutation('directory.mapping', { onSuccess: onChange });
  const commit = useApiMutation('directory.commit', {
    invalidates: [...inv],
    onSuccess: (d) => (onChange(d), toast.show({ title: t('admin.import.committed'), tone: 'success' })),
  });
  const fields = FIELDS[imp.kind];
  const c = imp.counts;
  const tiles: Array<[string, number, 'neutral' | 'ok' | 'low' | 'out']> = [
    [t('admin.import.new'), c.new, 'ok'],
    [t('admin.import.changed'), c.changed, 'neutral'],
    [t('admin.import.unchanged'), c.unchanged, 'neutral'],
    [t('admin.import.invalid'), c.invalid, c.invalid ? 'out' : 'neutral'],
  ];
  if (imp.kind === 'STUDENTS') tiles.push([t('admin.import.missing'), c.missing, c.missing ? 'low' : 'neutral']);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold tracking-heading">{imp.fileName}</h2>
        <StatusCapsule tone={STATUS_TONE[imp.status]}>{t(`admin.import.status_${imp.status}`)}</StatusCapsule>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([label, value, tone]) => (
          <KpiCounter key={label} label={label} value={value} tone={tone} />
        ))}
      </div>
      {imp.status === 'PREVIEW' && (
        <Panel title={t('admin.import.mapping')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {imp.detectedHeaders.map((h) => (
              <Select
                key={h}
                label={h}
                value={imp.mapping[h] ?? ''}
                disabled={remap.isPending}
                onChange={(v) =>
                  remap.mutate({ params: { id: imp.id }, body: { mapping: { ...imp.mapping, [h]: v || null } } })
                }
                options={[
                  { value: '', label: `— ${t('admin.import.ignore')} —` },
                  ...fields.map((f) => ({ value: f, label: f })),
                ]}
              />
            ))}
          </div>
        </Panel>
      )}
      {imp.issueCount > 0 && (
        <Panel
          title={`${t('admin.import.problems')} (${imp.issueCount})`}
          actions={
            <Button
              size="sm"
              variant="secondary"
              icon={<Download size={14} />}
              onClick={() =>
                void downloadCsv('directory.errors', { params: { id: imp.id } }, `import-${imp.id}-problems.csv`)
              }
            >
              {t('admin.import.downloadProblems')}
            </Button>
          }
        >
          <Table caption={t('admin.import.problems')}>
            <THead>
              <Tr>
                <Th numeric>{t('admin.import.row')}</Th>
                <Th>{t('admin.import.field')}</Th>
                <Th>{t('admin.import.problems')}</Th>
              </Tr>
            </THead>
            <TBody>
              {imp.issues.map((i, n) => (
                <Tr key={`${i.row}-${n}`}>
                  <Td numeric>{i.row}</Td>
                  <Td className="font-mono text-sm">{i.field ?? '—'}</Td>
                  <Td className="text-sm">{i.message}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Panel>
      )}
      {imp.status === 'PREVIEW' && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-4">
            {imp.kind === 'STUDENTS' ? (
              <Toggle
                label={t('admin.import.deactivateMissing')}
                hint={`${c.missing}`}
                checked={deactivate}
                onChange={setDeactivate}
              />
            ) : (
              <span />
            )}
            <Button
              size="lg"
              loading={commit.isPending}
              disabled={c.new + c.changed === 0 && !(deactivate && c.missing)}
              onClick={() =>
                commit.mutate(
                  { params: { id: imp.id }, body: { deactivateMissing: deactivate } },
                  { onError: (e) => setError(problemText(e, t('admin.ui.error'))) },
                )
              }
            >
              {t('admin.import.commit')} ({c.new + c.changed})
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-out-text">
              {error}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

function Connector({ onImport }: { onImport: (d: DirectoryImportDto) => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cfg = useApi('directory.connectorGet');
  const [form, setForm] = useState({
    enabled: false,
    baseUrl: '',
    authType: 'NONE' as 'NONE' | 'API_KEY',
    header: 'x-api-key',
    key: '',
    studentsPath: '/students',
    itemsPath: 'items',
    pagination: 'PAGE' as 'NONE' | 'PAGE' | 'CURSOR',
    mapping: '{}',
    scheduleCron: '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'sync' | null>(null);
  useEffect(() => {
    const c = cfg.data;
    if (!c) return;
    setForm({
      enabled: c.enabled,
      baseUrl: c.baseUrl ?? '',
      authType: c.auth.type === 'API_KEY' ? 'API_KEY' : 'NONE',
      header: c.auth.type === 'API_KEY' ? c.auth.header : 'x-api-key',
      key: '',
      studentsPath: c.studentsPath,
      itemsPath: c.itemsPath,
      pagination: c.pagination,
      mapping: JSON.stringify(c.mapping, null, 2),
      scheduleCron: c.scheduleCron ?? '',
    });
  }, [cfg.data]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const run = async (kind: 'save' | 'test' | 'sync', fn: () => Promise<void>) => {
    setBusy(kind);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: problemText(e, t('admin.ui.error')) });
    } finally {
      setBusy(null);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run('save', async () => {
      let mapping: Record<string, string>;
      try {
        mapping = JSON.parse(form.mapping || '{}') as Record<string, string>;
      } catch {
        throw new Error('JSON');
      }
      await api.call('directory.connectorUpdate', {
        body: {
          enabled: form.enabled,
          baseUrl: form.baseUrl || null,
          auth:
            form.authType === 'API_KEY'
              ? { type: 'API_KEY', header: form.header, key: form.key || undefined }
              : { type: 'NONE' },
          studentsPath: form.studentsPath,
          itemsPath: form.itemsPath,
          pagination: form.pagination,
          mapping,
          scheduleCron: form.scheduleCron || null,
        },
      });
      await cfg.refetch();
      toast.show({ title: t('admin.ui.saved'), tone: 'success' });
    });
  };
  const c = cfg.data;
  return (
    <Panel title={t('admin.import.connector')}>
      <p className="mb-4 text-sm text-text-muted">{t('admin.import.connectorHint')}</p>
      <form className="grid gap-4" onSubmit={save}>
        <Toggle label={t('admin.import.enabled')} checked={form.enabled} onChange={(v) => set('enabled', v)} />
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label={t('admin.import.baseUrl')}
            type="url"
            placeholder="https://sis.ictuniversity.edu.cm/api"
            value={form.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
          />
          <Select
            label={t('admin.import.authType')}
            value={form.authType}
            onChange={(v) => set('authType', v as 'NONE' | 'API_KEY')}
            options={[
              { value: 'NONE', label: 'None' },
              { value: 'API_KEY', label: 'API key' },
            ]}
          />
          {form.authType === 'API_KEY' && (
            <>
              <Input
                label={t('admin.import.apiKeyHeader')}
                value={form.header}
                onChange={(e) => set('header', e.target.value)}
              />
              <Input
                label={t('admin.import.apiKey')}
                type="password"
                autoComplete="new-password"
                value={form.key}
                onChange={(e) => set('key', e.target.value)}
                hint={c?.auth.type === 'API_KEY' && c.auth.hasKey ? t('admin.import.secretSaved') : undefined}
              />
            </>
          )}
          <Input
            label={t('admin.import.studentsPath')}
            value={form.studentsPath}
            onChange={(e) => set('studentsPath', e.target.value)}
          />
          <Input
            label={t('admin.import.itemsPath')}
            value={form.itemsPath}
            onChange={(e) => set('itemsPath', e.target.value)}
          />
          <Select
            label={t('admin.import.pagination')}
            value={form.pagination}
            onChange={(v) => set('pagination', v as 'NONE' | 'PAGE' | 'CURSOR')}
            options={['NONE', 'PAGE', 'CURSOR'].map((v) => ({ value: v, label: v }))}
          />
          <Input
            label={t('admin.import.schedule')}
            mono
            value={form.scheduleCron}
            onChange={(e) => set('scheduleCron', e.target.value)}
            hint={t('admin.import.scheduleHint')}
          />
        </div>
        <label className="grid gap-1.5 text-[13px] font-semibold">
          {t('admin.import.fieldMap')}
          <textarea
            className="lp-textarea font-mono"
            rows={6}
            value={form.mapping}
            onChange={(e) => set('mapping', e.target.value)}
            placeholder='{ "matricule": "regNo", "first_name": "names.first" }'
          />
        </label>
        {c?.lastSyncAt && (
          <p className="text-xs text-text-muted">
            {t('admin.import.lastSync')}: {formatDateTime(c.lastSyncAt, locale)}
          </p>
        )}
        {msg && <StatusCapsule tone={msg.ok ? 'ok' : 'out'}>{msg.text}</StatusCapsule>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === 'save'}>
            {t('admin.ui.save')}
          </Button>
          <Button
            variant="secondary"
            icon={<PlugZap size={16} />}
            loading={busy === 'test'}
            onClick={() =>
              void run('test', async () => {
                const r = await api.call('directory.connectorTest');
                setMsg({ ok: r.ok, text: r.message });
              })
            }
          >
            {t('admin.import.test')}
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw size={16} />}
            loading={busy === 'sync'}
            onClick={() => void run('sync', async () => onImport(await api.call('directory.connectorSync')))}
          >
            {t('admin.import.syncNow')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ImportView() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<'STUDENTS' | 'CARD_BATCH'>('STUDENTS');
  const [file, setFile] = useState<File | null>(null);
  const [current, setCurrent] = useState<DirectoryImportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rollback, setRollback] = useState<DirectoryImportDto | null>(null);
  const history = useApi('directory.list');
  const upload = useApiMutation('directory.upload', { invalidates: ['directory.list'], onSuccess: setCurrent });
  const undo = useApiMutation('directory.rollback', { invalidates: ['directory.list', 'students.list'] });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    upload.mutate(
      { query: { kind, fileName: file.name }, body: file, contentType: contentTypeOf(file) },
      { onError: (err) => setError(problemText(err, t('admin.ui.error'))) },
    );
  };

  return (
    <>
      <PageHeader
        title={t('admin.import.title')}
        actions={
          <Button
            variant="secondary"
            icon={<Download size={16} />}
            onClick={() =>
              void downloadCsv('directory.template', { query: { kind } }, `labpass-${kind.toLowerCase()}-template.csv`)
            }
          >
            {t('admin.import.template')}
          </Button>
        }
      />
      <div className="grid gap-4">
        <Panel>
          <form className="grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-end" onSubmit={submit}>
            <Select
              label={t('admin.import.kind')}
              value={kind}
              onChange={(v) => setKind(v as 'STUDENTS' | 'CARD_BATCH')}
              options={(['STUDENTS', 'CARD_BATCH'] as const).map((k) => ({ value: k, label: t(`admin.import.${k}`) }))}
            />
            <label className="grid gap-1.5 text-[13px] font-semibold">
              {t('admin.import.upload')}
              <input
                type="file"
                required
                accept=".csv,.txt,.xlsx"
                className="rounded-field border border-dashed border-line bg-surface p-3 text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="text-xs font-normal text-text-muted">{t('admin.import.drop')}</span>
            </label>
            <Button type="submit" icon={<Upload size={16} />} loading={upload.isPending} disabled={!file}>
              {t('admin.import.preview')}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-out-text">
              {error}
            </p>
          )}
        </Panel>
        {current && <Preview imp={current} onChange={setCurrent} />}
        <Panel title={t('admin.import.history')}>
          <Loadable
            query={history}
            rows={4}
            empty={(h) => (h.length ? null : <p className="text-sm text-text-muted">—</p>)}
          >
            {(list) => (
              <Table caption={t('admin.import.history')}>
                <THead>
                  <Tr>
                    <Th>{t('admin.inventory.when')}</Th>
                    <Th>{t('admin.import.kind')}</Th>
                    <Th>{t('admin.loans.status')}</Th>
                    <Th numeric>{t('admin.import.new')}</Th>
                    <Th numeric>{t('admin.import.changed')}</Th>
                    <Th numeric>{t('admin.import.invalid')}</Th>
                    <Th>
                      <span className="lp-sr-only">{t('admin.ui.actions')}</span>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {list.map((h) => (
                    <Tr key={h.id}>
                      <Td className="whitespace-nowrap text-sm">
                        <button type="button" className="lp-link text-left" onClick={() => setCurrent(h)}>
                          {formatDateTime(h.createdAt, locale)}
                        </button>
                        <div className="text-xs text-text-muted">{h.fileName ?? h.source}</div>
                      </Td>
                      <Td className="text-sm">{t(`admin.import.${h.kind}`)}</Td>
                      <Td>
                        <StatusCapsule tone={STATUS_TONE[h.status]}>
                          {t(`admin.import.status_${h.status}`)}
                        </StatusCapsule>
                      </Td>
                      <Td numeric>{h.counts.new}</Td>
                      <Td numeric>{h.counts.changed}</Td>
                      <Td numeric>{h.counts.invalid}</Td>
                      <Td className="text-right">
                        {h.status === 'COMMITTED' && (
                          <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => setRollback(h)}>
                            {t('admin.import.rollback')}
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Loadable>
        </Panel>
        {can('SUPER_ADMIN') && <Connector onImport={setCurrent} />}
      </div>
      <Dialog
        open={rollback !== null}
        onOpenChange={(o) => !o && setRollback(null)}
        title={t('admin.import.rollback')}
        description={t('admin.import.rollbackConfirm')}
        closeLabel={t('admin.ui.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRollback(null)}>
              {t('admin.ui.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={undo.isPending}
              onClick={() =>
                rollback &&
                undo.mutate(
                  { params: { id: rollback.id } },
                  {
                    onSuccess: (d) => (
                      setRollback(null),
                      current?.id === d.id && setCurrent(d),
                      toast.show({ title: t('admin.import.rolledBack'), tone: 'info' })
                    ),
                    onError: (e) => toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' }),
                  },
                )
              }
            >
              {t('admin.import.rollback')}
            </Button>
          </>
        }
      />
    </>
  );
}

export default function ImportPage() {
  return (
    <RoleGate role="LAB_ADMIN">
      <ImportView />
    </RoleGate>
  );
}
