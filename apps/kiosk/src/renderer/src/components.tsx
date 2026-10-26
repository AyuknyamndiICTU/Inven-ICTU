import { cn } from '@labpass/ui';
import { Delete } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from './i18n';

export function Glass({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('k-glass', className)}>{children}</div>;
}

export function Avatar({ name, photoUrl, size = 160 }: { name: string; photoUrl?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <div className="k-avatar" style={{ width: size, height: size }}>
      {photoUrl ? <img src={photoUrl} alt="" /> : <span aria-hidden>{initials}</span>}
    </div>
  );
}

const ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL/', 'ZXCVBNM-'];

/** Big-key keyboard for matricules (letters, digits, "/" and "-"). The physical keyboard works too. */
export function OnScreenKeyboard({
  onKey,
  onBackspace,
  disabled,
}: {
  onKey: (k: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="k-keyboard" role="group" aria-label={t('kiosk.keyboard')}>
      {ROWS.map((row, i) => (
        <div key={row} className="k-keyboard__row">
          {[...row].map((k) => (
            <button key={k} type="button" className="k-key" disabled={disabled} onClick={() => onKey(k)}>
              {k}
            </button>
          ))}
          {i === ROWS.length - 1 && (
            <button
              type="button"
              className="k-key k-key--wide"
              disabled={disabled}
              onClick={onBackspace}
              aria-label={t('kiosk.backspace')}
            >
              <Delete aria-hidden size={28} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Large step heading used on every session screen. */
export function StageTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <header className="k-stage-title">
      {kicker && <p className="k-kicker">{kicker}</p>}
      <h1>{children}</h1>
    </header>
  );
}

export function Notice({ children, tone = 'low' }: { children: ReactNode; tone?: 'low' | 'out' | 'signal' }) {
  return (
    <p className={cn('k-notice', `k-notice--${tone}`)} role="alert">
      {children}
    </p>
  );
}
