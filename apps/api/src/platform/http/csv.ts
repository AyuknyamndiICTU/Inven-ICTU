/**
 * CSV writer that neutralises spreadsheet formula injection (cells starting with = + - @ tab or CR are prefixed
 * with an apostrophe). Every CSV LabPass generates (exports, import error reports) goes through this function.
 */
const DANGEROUS = /^[=+\-@\t\r]/;

export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (DANGEROUS.test(s)) s = `'${s}`;
  if (/[",\r\n;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toSafeCsv(header: string[], rows: Array<Array<unknown>>): string {
  const lines = [header.map(safeCell).join(','), ...rows.map((r) => r.map(safeCell).join(','))];
  // BOM so Excel opens UTF-8 (accents in French names) correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
