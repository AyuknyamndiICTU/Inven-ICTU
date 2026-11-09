import {
  Button,
  type ComboItem,
  EquipmentCombobox,
  EquipmentIcon,
  FannedCart,
  IconButton,
  QuantityStepper,
  Skeleton,
} from '@labpass/ui';
import { ArrowLeft, MapPin, X } from 'lucide-react';
import { useState } from 'react';
import type { KioskEquipment } from '../../../shared/ipc';
import { Notice, StageTitle } from '../components';
import { useI18n } from '../i18n';
import type { CartLine, KioskMachineEvent } from '../machine';

/** K4: searchable grouped combobox (the "dropdown") → quantity steppers → A4 fanned cart → confirm. */
export function BorrowStage({
  catalog,
  cart,
  notice,
  busy,
  name,
  location,
  locations,
  send,
}: {
  catalog: KioskEquipment[] | null;
  cart: CartLine[];
  notice: string | null;
  busy: boolean;
  name: string;
  location: string | null;
  locations: string[];
  send: (e: KioskMachineEvent) => void;
}) {
  const { t } = useI18n();
  const total = cart.reduce((n, l) => n + l.qty, 0);
  const OTHER = '__other__';
  const [other, setOther] = useState(() => Boolean(location && !locations.includes(location)));
  const choice = other ? OTHER : (location ?? '');
  const needsLocation = total > 0 && !location;
  const healthLabels = { OK: t('common.inStock'), LOW: t('common.lowStock'), OUT: t('common.outOfStock') };

  const add = (item: ComboItem) =>
    send({
      type: 'ADD_ITEM',
      item: { equipmentId: item.id, name: item.name, categoryName: item.categoryName, max: item.available },
    });

  return (
    <div className="k-flow">
      <div className="k-flow__head">
        <IconButton
          label={t('common.back')}
          icon={<ArrowLeft size={28} />}
          onClick={() => send({ type: 'BACK' })}
          disabled={busy}
          className="k-back"
        />
        <StageTitle kicker={name}>{t('kiosk.signInTitle')}</StageTitle>
      </div>

      <div className="k-flow__body k-borrow">
        <section className="k-borrow__pick">
          {catalog ? (
            <EquipmentCombobox
              size="kiosk"
              items={catalog}
              onSelect={add}
              label={t('kiosk.chooseEquipment')}
              placeholder={t('kiosk.searchPlaceholder')}
              emptyLabel={t('kiosk.noMatch')}
              selectedIds={cart.map((l) => l.equipmentId)}
              healthLabels={healthLabels}
            />
          ) : (
            <div className="grid gap-3" aria-busy>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          )}
        </section>

        <section className="k-borrow__cart" aria-label={t('kiosk.cart')}>
          <div className="k-location">
            <label className="k-location__label" htmlFor="k-location">
              <MapPin size={22} aria-hidden /> {t('kiosk.locationLabel')}
            </label>
            <select
              id="k-location"
              className={`k-select ${choice ? 'is-set' : ''}`}
              value={choice}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                setOther(v === OTHER);
                send({ type: 'SET_LOCATION', location: v === OTHER || v === '' ? null : v });
              }}
            >
              <option value="" disabled>
                {t('kiosk.locationPlaceholder')}
              </option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
              <option value={OTHER}>{t('kiosk.locationOther')}</option>
            </select>
            {other && (
              <input
                className="k-input"
                aria-label={t('kiosk.locationOtherLabel')}
                placeholder={t('kiosk.locationOtherLabel')}
                maxLength={80}
                autoFocus
                defaultValue={location ?? ''}
                disabled={busy}
                onChange={(e) =>
                  send({ type: 'SET_LOCATION', location: e.target.value.trim().length >= 2 ? e.target.value : null })
                }
              />
            )}
          </div>
          <h2 className="k-kicker">{t('kiosk.cart')}</h2>
          {notice && <Notice>{notice}</Notice>}
          {cart.length === 0 ? (
            <p className="k-empty">{t('kiosk.cartEmpty')}</p>
          ) : (
            <>
              <FannedCart
                items={cart.map((l) => ({
                  id: l.equipmentId,
                  name: l.name,
                  qty: l.qty,
                  icon: <EquipmentIcon name={l.name} category={l.categoryName} />,
                }))}
                label={t('kiosk.cart')}
                removeLabel={(n) => t('kiosk.removeItem', { name: n })}
                moreLabel={(n) => t('kiosk.moreItems', { count: n })}
                onRemove={(id) => send({ type: 'REMOVE_ITEM', equipmentId: id })}
                layoutIdPrefix="cart"
              />
              <ul className="k-lines">
                {cart.map((l) => (
                  <li key={l.equipmentId}>
                    <span className="k-lines__name">{l.name}</span>
                    <QuantityStepper
                      size="kiosk"
                      value={l.qty}
                      min={1}
                      max={Math.max(1, l.max)}
                      onChange={(qty) => send({ type: 'SET_QTY', equipmentId: l.equipmentId, qty })}
                      label={t('kiosk.qtyFor', { name: l.name })}
                      decreaseLabel={t('kiosk.decrease')}
                      increaseLabel={t('kiosk.increase')}
                    />
                    <IconButton
                      label={t('kiosk.removeItem', { name: l.name })}
                      icon={<X size={24} />}
                      onClick={() => send({ type: 'REMOVE_ITEM', equipmentId: l.equipmentId })}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          {needsLocation && (
            <p className="k-location__hint" role="status">
              {t('kiosk.locationRequired')}
            </p>
          )}
          <Button
            size="kiosk"
            className="k-confirm"
            disabled={total === 0 || !location}
            loading={busy}
            onClick={() => send({ type: 'CONFIRM' })}
          >
            {t('kiosk.confirmBorrow', { count: total })}
          </Button>
        </section>
      </div>
    </div>
  );
}
