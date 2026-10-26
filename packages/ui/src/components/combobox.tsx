import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { cn } from '../cn';
import { EquipmentIcon } from '../icons/equipment';
import { type Health, StockHealthBadge } from './badges';

export interface ComboItem {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  imageUrl?: string | null;
  available: number;
  health: Health;
}

export interface EquipmentComboboxProps {
  items: ComboItem[];
  onSelect: (item: ComboItem) => void;
  label: string;
  placeholder?: string;
  emptyLabel?: ReactNode;
  /** Item ids already in the cart (shown as selected). */
  selectedIds?: string[];
  healthLabels?: Record<Health, string>;
  size?: 'md' | 'kiosk';
  className?: string;
}

/**
 * The kiosk equipment "dropdown" (DESIGN §5 K4): searchable by name or code, grouped by category, with an image, the
 * live availability and items at 0 disabled. Keyboard and screen-reader support come from cmdk (combobox/listbox).
 */
export function EquipmentCombobox({
  items,
  onSelect,
  label,
  placeholder = 'Search equipment…',
  emptyLabel = 'No equipment matches.',
  selectedIds = [],
  healthLabels,
  size = 'md',
  className,
}: EquipmentComboboxProps) {
  const groups = useMemo(() => {
    const m = new Map<string, ComboItem[]>();
    for (const it of items) m.set(it.categoryName, [...(m.get(it.categoryName) ?? []), it]);
    return [...m.entries()];
  }, [items]);
  const selected = new Set(selectedIds);
  return (
    <Command label={label} className={cn('lp-combo', `lp-combo--${size}`, className)} loop>
      <div className="lp-combo__search">
        <Search aria-hidden size={size === 'kiosk' ? 24 : 18} />
        <Command.Input placeholder={placeholder} aria-label={label} />
      </div>
      <Command.List className="lp-combo__list">
        <Command.Empty className="lp-combo__empty">{emptyLabel}</Command.Empty>
        {groups.map(([category, list]) => (
          <Command.Group key={category} heading={category} className="lp-combo__group">
            {list.map((it) => (
              <Command.Item
                key={it.id}
                value={`${it.name} ${it.code} ${it.id}`}
                disabled={it.available <= 0}
                onSelect={() => onSelect(it)}
                className={cn('lp-combo__item', selected.has(it.id) && 'is-selected')}
              >
                <span className="lp-combo__thumb" aria-hidden>
                  {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <EquipmentIcon name={it.name} />}
                </span>
                <span className="lp-combo__text">
                  <span className="lp-combo__name">{it.name}</span>
                  <span className="lp-combo__code lp-mono">{it.code}</span>
                </span>
                <StockHealthBadge health={it.health} available={it.available} labels={healthLabels} />
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}
