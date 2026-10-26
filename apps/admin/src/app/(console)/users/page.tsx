'use client';

import type { AdminRole } from '@labpass/contracts';
import { Button, Dialog, Input, StatusCapsule, Table, TBody, Td, Th, THead, Tr, useToast } from '@labpass/ui';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Loadable, PageHeader, RoleGate, Select } from '@/components/page';
import { fieldErrors, problemText, useApi, useApiMutation } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const ROLES: AdminRole[] = ['SUPER_ADMIN', 'LAB_ADMIN', 'LAB_ASSISTANT', 'VIEWER'];

function UsersView() {
  const { t, locale } = useI18n();
  const { user: me } = useSession();
  const toast = useToast();
  const users = useApi('adminUsers.list');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'LAB_ASSISTANT' as AdminRole, password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useApiMutation('adminUsers.create', { invalidates: ['adminUsers.list'] });
  const update = useApiMutation('adminUsers.update', { invalidates: ['adminUsers.list'] });
  const resetTotp = useApiMutation('adminUsers.resetTotp', { invalidates: ['adminUsers.list'] });
  const fail = (e: unknown) => toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    create.mutate(
      { body: form },
      {
        onSuccess: () => (
          setOpen(false),
          setForm({ name: '', email: '', role: 'LAB_ASSISTANT', password: '' }),
          toast.show({ title: t('admin.users.created'), tone: 'success' })
        ),
        onError: (err) => setErrors({ ...fieldErrors(err), _: problemText(err, t('admin.ui.error')) }),
      },
    );
  };

  return (
    <>
      <PageHeader
        title={t('admin.users.title')}
        actions={
          <Button icon={<Plus size={18} />} onClick={() => setOpen(true)}>
            {t('admin.users.add')}
          </Button>
        }
      />
      <Loadable query={users} rows={4}>
        {(list) => (
          <Table caption={t('admin.users.title')}>
            <THead>
              <Tr>
                <Th>{t('admin.users.name')}</Th>
                <Th>{t('admin.users.role')}</Th>
                <Th>{t('admin.users.totp')}</Th>
                <Th>{t('admin.users.lastLogin')}</Th>
                <Th>{t('admin.users.active')}</Th>
                <Th>
                  <span className="lp-sr-only">{t('admin.ui.actions')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {list.map((u) => (
                <Tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                  <Td>
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-xs text-text-muted">{u.email}</div>
                  </Td>
                  <Td>
                    <Select
                      label={`${t('admin.users.role')} · ${u.name}`}
                      hideLabel
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={(role) =>
                        update.mutate({ params: { id: u.id }, body: { role: role as AdminRole } }, { onError: fail })
                      }
                      options={ROLES.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))}
                    />
                  </Td>
                  <Td>
                    {u.totpEnabled ? (
                      <StatusCapsule tone="ok">✓</StatusCapsule>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-sm">
                    {u.lastLoginAt ? relativeTime(u.lastLoginAt, locale) : t('admin.ui.never')}
                  </Td>
                  <Td>
                    <StatusCapsule tone={u.active ? 'ok' : 'neutral'}>
                      {u.active ? t('admin.users.active') : t('admin.users.deactivate')}
                    </StatusCapsule>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {u.id !== me.id && (
                      <div className="flex justify-end gap-2">
                        {u.totpEnabled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<ShieldCheck size={14} />}
                            onClick={() => resetTotp.mutate({ params: { id: u.id } }, { onError: fail })}
                          >
                            {t('admin.users.resetTotp')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            update.mutate({ params: { id: u.id }, body: { active: !u.active } }, { onError: fail })
                          }
                        >
                          {u.active ? t('admin.users.deactivate') : t('admin.users.activate')}
                        </Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Loadable>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('admin.users.add')}
        closeLabel={t('admin.ui.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('admin.ui.cancel')}
            </Button>
            <Button type="submit" form="user-form" loading={create.isPending}>
              {t('admin.ui.confirm')}
            </Button>
          </>
        }
      >
        <form id="user-form" className="grid gap-4" onSubmit={submit}>
          <Input
            label={t('admin.users.name')}
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={errors.name}
          />
          <Input
            label={t('admin.users.email')}
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            error={errors.email}
          />
          <Select
            label={t('admin.users.role')}
            value={form.role}
            onChange={(v) => setForm((f) => ({ ...f, role: v as AdminRole }))}
            options={ROLES.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))}
          />
          <Input
            label={t('admin.users.password')}
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            error={errors.password}
          />
          {errors._ && !Object.keys(errors).some((k) => k !== '_') && (
            <p role="alert" className="text-sm font-semibold text-out-text">
              {errors._}
            </p>
          )}
        </form>
      </Dialog>
    </>
  );
}

export default function UsersPage() {
  return (
    <RoleGate role="SUPER_ADMIN">
      <UsersView />
    </RoleGate>
  );
}
