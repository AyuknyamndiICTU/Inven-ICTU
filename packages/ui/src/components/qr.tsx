import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from '../cn';

/**
 * QR code as crisp SVG (one path, no innerHTML). Used for TOTP setup, kiosk registration and the kiosk's live
 * challenge code (A13). `label` is the accessible name; the encoded text is never announced.
 */
export function QrCode({
  value,
  label,
  size = 200,
  ecc = 'M',
  className,
}: {
  value: string;
  label: string;
  size?: number;
  ecc?: 'L' | 'M' | 'Q' | 'H';
  className?: string;
}) {
  const { path, n } = useMemo(() => {
    const qr = encode(value, { ecc, border: 2 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, n: qr.size };
  }, [value, ecc]);
  return (
    <svg
      className={cn('lp-qr', className)}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#07080A" />
    </svg>
  );
}
