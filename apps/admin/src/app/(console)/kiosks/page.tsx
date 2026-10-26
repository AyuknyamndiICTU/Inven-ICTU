'use client';

import { Button, Dialog, Input, QrCode, StatusCapsule, Table, TBody, Td, Th, THead, Tr, useToast } from '@labpass/ui';
import { KeyRound, Plus, ShieldOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Empty, Loadable, PageHeader, RoleGate } from '@/components/page';
import { problemText, useApi, useApiMutation } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

function CodeDialog({
  code,
  onClose,
}: {
  code: { name: string; registrationCode: string; expiresAt: string } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!code) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={code.name}
      description={t('admin.kiosks.codeHint')}
      closeLabel={t('admin.ui.close')}
      footer={<Button onClick={onClose}>{t('admin.ui.close')}</Button>}
    >
      <div className="grid justify-items-center gap-4">
        <QrCode value={`LPKR1.${code.registrationCode}`} label={t('admin.kiosks.code')} size={200} />
        <p className="font-mono text-4xl font-bold tracking-[0.2em]" aria-label={t('admin.kiosks.code')}>
          {code.registrationCode}
        </p>
      </div>
    </Dialog>
  );
}

function KiosksView() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const kiosks = useApi('kiosks.list', undefined, { refetchInterval: 30_000 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ name: string; registrationCode: string; expiresAt: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const create = useApiMutation('kiosks.create', { invalidates: ['kiosks.list'] });
  const newCode = useApiMutation('kiosks.newCode', { invalidates: ['kiosks.list'] });
  const revoke = useApiMutation('kiosks.revoke', { invalidates: ['kiosks.list', 'dashboard.summary'] });
  const superAdmin = can('SUPER_ADMIN');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { body: { name, location: location || undefined } },
      {
        onSuccess: (r) => {
          setCreating(false);
          setName('');
          setLocation('');
          setCode({ name: r.kiosk.name, registrationCode: r.registrationCode, expiresAt: r.expiresAt });
        },
        onError: (err) => setError(problemText(err, t('admin.ui.error'))),
      },
    );
  };

  return (
    <>
      <PageHeader
        title={t('admin.kiosks.title')}
        actions={
          superAdmin && (
            <Button icon={<Plus size={18} />} onClick={() => setCreating(true)}>
              {t('admin.kiosks.register')}
            </Button>
          )
        }
      />
      <Loadable
        query={kiosks}
        rows={3}
        empty={(k) =>
          k.length ? null : (
            <Empty
              title={t('admin.kiosks.empty')}
              action={superAdmin && <Button onClick={() => setCreating(true)}>{t('admin.kiosks.register')}</Button>}
            />
          )
        }
      >
        {(list) => (
          <Table caption={t('admin.kiosks.title')}>
            <THead>
              <Tr>
                <Th>{t('admin.kiosks.name')}</Th>
                <Th>{t('admin.loans.status')}</Th>
                <Th>{t('admin.kiosks.reader')}</Th>
                <Th>{t('admin.kiosks.version')}</Th>
                <Th>{t('admin.kiosks.lastSeen')}</Th>
                {superAdmin && (
                  <Th>
                    <span className="lp-sr-only">{t('admin.ui.actions')}</span>
                  </Th>
                )}
              </Tr>
            </THead>
            <TBody>
              {list.map((k) => (
                <Tr key={k.id}>
                  <Td>
                    <div className="font-semibold">{k.name}</div>
                    {k.location && <div className="text-xs text-text-muted">{k.location}</div>}
                  </Td>
                  <Td>
                    {k.status === 'REVOKED' ? (
                      <StatusCapsule tone="out">{t('admin.kiosks.revoked')}</StatusCapsule>
                    ) : k.status === 'PENDING' ? (
                      <StatusCapsule tone="low">{t('admin.kiosks.pending')}</StatusCapsule>
                    ) : (
                      <StatusCapsule tone={k.online ? 'ok' : 'neutral'}>
                        {k.online ? t('admin.kiosks.online') : t('admin.kiosks.offline')}
                      </StatusCapsule>
                    )}
                  </Td>
                  <Td className="text-sm">{k.readerStatus ?? '—'}</Td>
                  <Td className="font-mono text-sm">{k.appVersion ?? '—'}</Td>
                  <Td className="text-sm">{k.lastSeenAt ? relativeTime(k.lastSeenAt, locale) : t('admin.ui.never')}</Td>
                  {superAdmin && (
                    <Td className="whitespace-nowrap text-right">
                      {k.status !== 'REVOKED' && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<KeyRound size={14} />}
                            loading={newCode.isPending && newCode.variables?.params.id === k.id}
                            onClick={() =>
                              newCode.mutate(
                                { params: { id: k.id } },
                                {
                                  onSuccess: (r) =>
                                    setCode({
                                      name: k.name,
                                      registrationCode: r.registrationCode,
                                      expiresAt: r.expiresAt,
                                    }),
                                },
                              )
                            }
                          >
                            {t('admin.kiosks.newCode')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<ShieldOff size={14} />}
                            onClick={() => setRevoking({ id: k.id, name: k.name })}
                          >
                            {t('admin.kiosks.revoke')}
                          </Button>
                        </div>
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Loadable>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t('admin.kiosks.register')}
        closeLabel={t('admin.ui.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('admin.ui.cancel')}
            </Button>
            <Button type="submit" form="kiosk-form" loading={create.isPending}>
              {t('admin.ui.confirm')}
            </Button>
          </>
        }
      >
        <form id="kiosk-form" className="grid gap-4" onSubmit={submit}>
          <Input
            label={t('admin.kiosks.name')}
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cisco Lab Kiosk 1"
          />
          <Input label={t('admin.kiosks.location')} value={location} onChange={(e) => setLocation(e.target.value)} />
          {error && (
            <p role="alert" className="text-sm font-semibold text-out-text">
              {error}
            </p>
          )}
        </form>
      </Dialog>
      <Dialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`${t('admin.kiosks.revoke')}: ${revoking?.name ?? ''}`}
        description={t('admin.kiosks.revokeConfirm')}
        closeLabel={t('admin.ui.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevoking(null)}>
              {t('admin.ui.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              onClick={() =>
                revoking &&
                revoke.mutate(
                  { params: { id: revoking.id } },
                  {
                    onSuccess: () => (
                      setRevoking(null),
                      toast.show({ title: t('admin.kiosks.revoked'), tone: 'info' })
                    ),
                    onError: (e) => toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' }),
                  },
                )
              }
            >
              {t('admin.kiosks.revoke')}
            </Button>
          </>
        }
      />
      <CodeDialog code={code} onClose={() => setCode(null)} />
    </>
  );
}

export default function KiosksPage() {
  return (
    <RoleGate role="LAB_ASSISTANT">
      <KiosksView />
    </RoleGate>
  );
}
