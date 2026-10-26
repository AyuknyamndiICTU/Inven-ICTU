import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PII-free rotating log (S11 task 1). Messages are short event codes; `scrub` removes anything that could identify a
 * student even if a caller slips: tokens, UIDs/long hex, UUIDs, emails, phone numbers and matricule-like strings.
 */
export function scrub(text: string): string {
  return text
    .replace(/\b(Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[phone]')
    .replace(/\b[0-9A-F]{8,}\b/gi, '[hex]')
    .replace(/\b[A-Z]{2,}\d{2,}[A-Z0-9/-]*\b/g, '[matricule]')
    .replace(/LP[KR][R12]?\.[\w.-]+/g, '[qr]');
}

export class RotatingLog {
  constructor(
    private readonly dir: string,
    private readonly maxBytes = 1_000_000,
    private readonly keep = 3,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private get file() {
    return join(this.dir, 'kiosk.log');
  }

  private rotate() {
    try {
      if (!existsSync(this.file) || statSync(this.file).size < this.maxBytes) return;
      rmSync(`${this.file}.${this.keep}`, { force: true });
      for (let i = this.keep - 1; i >= 1; i--) {
        if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
      }
      renameSync(this.file, `${this.file}.1`);
    } catch {
      // Logging must never break the kiosk.
    }
  }

  write(level: 'info' | 'warn' | 'error', event: string, detail?: string) {
    this.rotate();
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${event}${detail ? ` ${scrub(detail)}` : ''}\n`;
    try {
      appendFileSync(this.file, line);
    } catch {
      // Disk full or permissions: drop the line.
    }
  }

  info(event: string, detail?: string) {
    this.write('info', event, detail);
  }
  warn(event: string, detail?: string) {
    this.write('warn', event, detail);
  }
  error(event: string, detail?: string) {
    this.write('error', event, detail);
  }
}
