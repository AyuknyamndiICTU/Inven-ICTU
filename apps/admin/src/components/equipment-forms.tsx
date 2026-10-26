'use client';

import type { Equipment } from '@labpass/contracts/client';
import { Button, Drawer, Input, useToast } from '@labpass/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Select, Toggle } from '@/components/page';
import { api, fieldErrors, problemText, useApi, useApiMutation } from '@/lib/api';
import { useT } from '@/lib/i18n';

const INVALIDATE = [
  'equipment.list',
  'equipment.get',
  'equipment.movements',
  'dashboard.summary',
  'categories.list',
] as const;

/** Add or edit equipment. Quantities are only set at creation; afterwards they change through "Adjust stock". */
export function EquipmentDrawer({
  open,
  onOpenChange,
  equipment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  equipment?: Equipment | null;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const categories = useApi('categories.list', undefined, { enabled: open });
  const settings = useApi('settings.get', undefined, { enabled: open });
  const editing = Boolean(equipment);
  const [form, setForm] = useState({
    code: '',
    name: '',
    categoryId: '',
    description: '',
    unit: 'unit',
    totalQuantity: 1,
    threshold: 2,
    useGlobal: true,
    active: true,
  });
  const [newCategory, setNewCategory] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    setImage(null);
    setNewCategory('');
    setForm(
      equipment
        ? {
            code: equipment.code,
            name: equipment.name,
            categoryId: equipment.categoryId,
            description: equipment.description ?? '',
            unit: equipment.unit,
            totalQuantity: equipment.totalQuantity,
            threshold: equipment.lowStockThreshold ?? equipment.effectiveThreshold,
            useGlobal: equipment.lowStockThreshold === null,
            active: equipment.active,
          }
        : {
            code: '',
            name: '',
            categoryId: '',
            description: '',
            unit: 'unit',
            totalQuantity: 1,
            threshold: 2,
            useGlobal: true,
            active: true,
          },
    );
  }, [open, equipment]);

  useEffect(() => {
    if (!form.categoryId && categories.data?.[0]) setForm((f) => ({ ...f, categoryId: categories.data![0]!.id }));
  }, [categories.data, form.categoryId]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      let categoryId = form.categoryId;
      if (newCategory.trim())
        categoryId = (await api.call('categories.create', { body: { name: newCategory.trim() } })).id;
      const common = {
        code: form.code.trim().toUpperCase(),
        name: form.name,
        categoryId,
        description: form.description || null,
        unit: form.unit,
        lowStockThreshold: form.useGlobal ? null : form.threshold,
      };
      const saved = editing
        ? await api.call('equipment.update', {
            params: { id: equipment!.id },
            body: { ...common, active: form.active },
          })
        : await api.call('equipment.create', { body: { ...common, totalQuantity: form.totalQuantity } });
      if (image)
        await api.call('equipment.image', {
          params: { id: saved.id },
          body: image,
          contentType: image.type || 'application/octet-stream',
        });
      await Promise.all(INVALIDATE.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.show({
        title: editing ? t('admin.inventory.updated') : t('admin.inventory.created'),
        description: saved.name,
        tone: 'success',
      });
      onOpenChange(false);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(problemText(err, t('admin.ui.error')));
    } finally {
      setBusy(false);
    }
  }

  const global = settings.data?.globalLowStockThreshold ?? 2;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t('admin.inventory.edit') : t('admin.inventory.add')}
      closeLabel={t('admin.ui.close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('admin.ui.cancel')}
          </Button>
          <Button type="submit" form="equipment-form" loading={busy}>
            {t('admin.ui.save')}
          </Button>
        </>
      }
    >
      <form id="equipment-form" className="grid gap-4" onSubmit={submit}>
        <Input
          label={t('admin.inventory.name')}
          required
          minLength={2}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <Input
          label={t('admin.inventory.code')}
          required
          mono
          value={form.code}
          onChange={(e) => set('code', e.target.value.toUpperCase())}
          error={errors.code}
          hint="RT-2911, SW-2960…"
        />
        <Select
          label={t('admin.inventory.category')}
          value={form.categoryId}
          onChange={(v) => set('categoryId', v)}
          options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Input
          label={`${t('admin.inventory.newCategory')} (${t('admin.ui.optional').toLowerCase()})`}
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
        />
        {!editing && (
          <Input
            label={t('admin.inventory.initialQty')}
            type="number"
            min={0}
            required
            value={form.totalQuantity}
            onChange={(e) => set('totalQuantity', Number(e.target.value))}
            error={errors.totalQuantity}
          />
        )}
        <div className="grid gap-2 rounded-field border border-line p-3">
          <Toggle
            label={t('admin.inventory.useGlobal', { value: global })}
            checked={form.useGlobal}
            onChange={(v) => set('useGlobal', v)}
          />
          {!form.useGlobal && (
            <Input
              label={t('admin.inventory.threshold')}
              type="number"
              min={0}
              value={form.threshold}
              onChange={(e) => set('threshold', Number(e.target.value))}
              error={errors.lowStockThreshold}
            />
          )}
        </div>
        <Input label={t('admin.inventory.unit')} value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        <label className="grid gap-1.5 text-[13px] font-semibold">
          {t('admin.inventory.description')}
          <textarea
            className="lp-textarea"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={2000}
          />
        </label>
        {editing && (
          <Toggle
            label={form.active ? t('admin.inventory.active') : t('admin.inventory.inactive')}
            checked={form.active}
            onChange={(v) => set('active', v)}
          />
        )}
        <label className="grid gap-1.5 text-[13px] font-semibold">
          {t('admin.inventory.image')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
          <span className="text-xs font-normal text-text-muted">{t('admin.inventory.imageHint')}</span>
        </label>
        {error && (
          <p role="alert" className="text-sm font-semibold text-out-text">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}

/** Increase or decrease quantity with a live preview; the API refuses to go below the quantity on loan. */
export function AdjustDrawer({
  open,
  onOpenChange,
  equipment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  equipment: Equipment | null;
}) {
  const t = useT();
  const toast = useToast();
  const [type, setType] = useState<'RESTOCK' | 'WRITE_OFF' | 'CORRECTION'>('RESTOCK');
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const undo = useApiMutation('equipment.undoAdjust', { invalidates: [...INVALIDATE] });
  const adjust = useApiMutation('equipment.adjust', {
    invalidates: [...INVALIDATE],
    onSuccess: (r) => {
      onOpenChange(false);
      toast.show({
        title: t('admin.inventory.adjusted', { name: r.equipment.name }),
        description: `${t('admin.inventory.total')} ${r.equipment.totalQuantity} · ${t('admin.inventory.available')} ${r.equipment.availableQuantity}`,
        tone: 'success',
        // A full 10 s from when the user sees it; the server accepts undo for 10 s + 5 s grace after the change.
        durationMs: 10_000,
        action: {
          label: t('common.undo'),
          onAction: () =>
            undo.mutate(
              { params: { id: r.equipment.id, movementId: r.movementId } },
              {
                onSuccess: () => toast.show({ title: t('admin.inventory.undone'), tone: 'info' }),
                onError: (e) => toast.show({ title: problemText(e, t('admin.ui.error')), tone: 'error' }),
              },
            ),
        },
      });
    },
  });

  useEffect(() => {
    if (open) {
      setType('RESTOCK');
      setDelta(1);
      setReason('');
      setError(null);
    }
  }, [open]);
  useEffect(() => {
    if (type === 'RESTOCK' && delta < 1) setDelta(1);
    if (type === 'WRITE_OFF' && delta > -1) setDelta(-1);
  }, [type, delta]);

  if (!equipment) return null;
  const out = equipment.totalQuantity - equipment.availableQuantity;
  const total = equipment.totalQuantity + delta;
  const available = equipment.availableQuantity + delta;
  const belowOut = total < out;
  const step = (d: number) =>
    setDelta((v) => {
      const n = v + d;
      if (n === 0) return n + d;
      if (type === 'RESTOCK') return Math.max(1, n);
      if (type === 'WRITE_OFF') return Math.min(-1, n);
      return n;
    });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    adjust.mutate(
      { params: { id: equipment!.id }, body: { type, delta, reason } },
      { onError: (err) => setError(problemText(err, t('admin.ui.error'))) },
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.inventory.adjust')}
      description={equipment.name}
      closeLabel={t('admin.ui.close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('admin.ui.cancel')}
          </Button>
          <Button
            type="submit"
            form="adjust-form"
            loading={adjust.isPending}
            disabled={belowOut || reason.trim().length < 3 || delta === 0}
          >
            {t('admin.ui.save')}
          </Button>
        </>
      }
    >
      <form id="adjust-form" className="grid gap-5" onSubmit={submit}>
        <div role="radiogroup" aria-label={t('admin.inventory.type')} className="flex flex-wrap gap-2">
          {(['RESTOCK', 'WRITE_OFF', 'CORRECTION'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={type === k}
              aria-pressed={type === k}
              className="lp-chip"
              onClick={() => setType(k)}
            >
              {t(`admin.inventory.${k}`)}
            </button>
          ))}
        </div>
        <div className="grid gap-2">
          <span className="text-[13px] font-semibold" id="delta-label">
            {t('admin.inventory.delta')}
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              aria-label="−1"
              icon={<Minus size={18} />}
              onClick={() => step(-1)}
              disabled={type === 'RESTOCK' && delta <= 1}
            />
            <input
              aria-labelledby="delta-label"
              className="lp-num-input lp-num-input--lg"
              type="number"
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value) || 0)}
            />
            <Button
              variant="secondary"
              aria-label="+1"
              icon={<Plus size={18} />}
              onClick={() => step(1)}
              disabled={type === 'WRITE_OFF' && delta >= -1}
            />
          </div>
        </div>
        <section aria-live="polite" className="rounded-tile border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold">{t('admin.inventory.preview')}</h3>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              [t('admin.inventory.total'), equipment.totalQuantity, total],
              [t('admin.inventory.available'), equipment.availableQuantity, available],
              [t('admin.inventory.out'), out, out],
            ].map(([label, before, after]) => (
              <div key={String(label)}>
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="font-mono text-2xl font-bold">
                  {after}
                  {before !== after && (
                    <span className="ml-1 text-xs font-medium text-text-muted">({String(before)})</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {belowOut && (
            <p role="alert" className="mt-3 text-sm font-semibold text-out-text">
              {t('admin.inventory.belowOut', { out })}
            </p>
          )}
        </section>
        <Input
          label={t('admin.inventory.reason')}
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint={t('admin.inventory.reasonHint')}
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-out-text">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}
