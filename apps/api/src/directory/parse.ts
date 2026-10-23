import ExcelJS from 'exceljs';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { Errors } from '../platform/http/problem';

/** ARCH §9 limits. */
export const LIMITS = { maxRows: 100_000, maxCols: 60, maxCell: 1000, maxInflatedBytes: 100 * 1024 * 1024 } as const;

export type Cell = string | number | Date | null;
export interface Table {
  headers: string[];
  rows: Cell[][];
}
export interface Issue {
  row: number;
  field: string | null;
  message: string;
}

export type ImportKind = 'STUDENTS' | 'CARD_BATCH';
export const STUDENT_FIELDS = [
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
] as const;
export const CARD_FIELDS = ['card_uid', 'matricule', 'batch_id', 'printed_at'] as const;
export const REQUIRED: Record<ImportKind, string[]> = {
  STUDENTS: ['matricule', 'first_name', 'last_name', 'date_of_birth'],
  CARD_BATCH: ['card_uid', 'matricule'],
};

const ALIASES: Record<string, string[]> = {
  matricule: [
    'matricule',
    'matric',
    'matricule_etudiant',
    'student_id',
    'studentid',
    'numero_matricule',
    'registration_number',
    'reg_no',
    'regno',
  ],
  first_name: ['first_name', 'firstname', 'prenom', 'prenoms', 'given_name', 'givenname'],
  last_name: ['last_name', 'lastname', 'nom', 'surname', 'family_name', 'nom_de_famille'],
  date_of_birth: [
    'date_of_birth',
    'dob',
    'birth_date',
    'birthdate',
    'date_de_naissance',
    'date_naissance',
    'ne_le',
    'nee_le',
  ],
  email: ['email', 'e_mail', 'mail', 'courriel', 'adresse_email', 'adresse_mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'numero_de_telephone', 'phone_number', 'portable'],
  program: ['program', 'programme', 'filiere', 'department', 'departement', 'field', 'specialite'],
  level: ['level', 'niveau', 'year', 'annee', 'classe'],
  status: ['status', 'statut', 'etat'],
  card_uid: ['card_uid', 'uid', 'card', 'carte', 'nfc_uid', 'uid_carte'],
  photo_url: ['photo_url', 'photo', 'picture', 'image_url', 'photo_link'],
  batch_id: ['batch_id', 'batch', 'lot'],
  printed_at: ['printed_at', 'print_date', 'date_impression'],
};

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function autoMap(headers: string[], kind: ImportKind): Record<string, string | null> {
  const fields: readonly string[] = kind === 'STUDENTS' ? STUDENT_FIELDS : CARD_FIELDS;
  const used = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const h of headers) {
    const n = normalizeHeader(h);
    const field = fields.find((f) => !used.has(f) && (ALIASES[f] ?? [f]).includes(n)) ?? null;
    if (field) used.add(field);
    mapping[h] = field;
  }
  return mapping;
}

// ───────────── Value normalisation ─────────────

/** Display form: trimmed, single spaces, Unicode NFC. Case and accents preserved. */
export function cleanName(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Matching form (ARCH §5 F7): trim, collapse whitespace, NFC, case-fold. Accents remain significant. */
export function normalizeName(s: string): string {
  return cleanName(s).toLocaleLowerCase('fr');
}

export function normalizeMatricule(s: string): string {
  return s.trim().toUpperCase();
}

const pad = (n: number) => String(n).padStart(2, '0');
function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Accepts Date cells, Excel serials, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy and yyyy-mm-dd. Returns ISO date or null. */
export function parseDate(v: Cell): string | null {
  if (v === null || v === '') return null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    if (v < 1 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  if (/^\d{4,5}$/.test(s)) return parseDate(Number(s));
  return null;
}

export function parseStatus(v: string | null): 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | null | 'INVALID' {
  if (!v) return null;
  const n = normalizeHeader(v);
  if (['active', 'actif', 'active_', 'enrolled', 'inscrit'].includes(n)) return 'ACTIVE';
  if (['inactive', 'inactif', 'graduated', 'diplome', 'left', 'parti'].includes(n)) return 'INACTIVE';
  if (['suspended', 'suspendu', 'suspendue'].includes(n)) return 'SUSPENDED';
  return 'INVALID';
}

export function normalizePhone(v: string | null): string | null | 'INVALID' {
  if (!v) return null;
  const p = parsePhoneNumberFromString(v.replace(/[^\d+]/g, ''), 'CM');
  return p?.isValid() ? p.number : 'INVALID';
}

export function normalizeUid(v: string | null): string | null | 'INVALID' {
  if (!v) return null;
  const h = v.replace(/[\s:-]/g, '').toUpperCase();
  return /^(?:[0-9A-F]{2}){4,10}$/.test(h) ? h : 'INVALID';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ───────────── File parsing ─────────────

/** Sums the uncompressed sizes in a ZIP central directory without inflating anything (zip-bomb guard). */
export function zipInflatedSize(buf: Buffer): number {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw Errors.badRequest('INVALID_FILE', 'The XLSX file is damaged.');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw Errors.badRequest('INVALID_FILE', 'The XLSX file is damaged.');
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff) return Number.POSITIVE_INFINITY; // ZIP64: treat as too large
    total += size;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return total;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue); // formulas: cached value only
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

function checkShape(table: Table): Table {
  if (table.headers.length === 0) throw Errors.badRequest('EMPTY_FILE', 'The file has no header row.');
  if (table.headers.length > LIMITS.maxCols)
    throw Errors.badRequest('TOO_MANY_COLUMNS', `At most ${LIMITS.maxCols} columns are allowed.`);
  if (table.rows.length > LIMITS.maxRows)
    throw Errors.badRequest('TOO_MANY_ROWS', `At most ${LIMITS.maxRows} rows are allowed.`);
  return table;
}

function decodeText(buf: Buffer): string {
  let text = buf.toString('utf8');
  if (text.includes('\uFFFD')) text = buf.toString('latin1'); // Excel "CSV (Windows)" exports
  return text.replace(/^\uFEFF/, '');
}

export async function parseTable(buf: Buffer): Promise<Table> {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isZip) {
    if (zipInflatedSize(buf) > LIMITS.maxInflatedBytes)
      throw Errors.badRequest('FILE_TOO_LARGE', 'The spreadsheet expands to more than 100 MB.');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw Errors.badRequest('INVALID_FILE', 'The file is not a readable XLSX workbook.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw Errors.badRequest('EMPTY_FILE', 'The workbook has no sheet.');
    if (ws.rowCount > LIMITS.maxRows + 1)
      throw Errors.badRequest('TOO_MANY_ROWS', `At most ${LIMITS.maxRows} rows are allowed.`);
    const all: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
      all.push(values);
    });
    const [head = [], ...rows] = all;
    return checkShape({ headers: head.map((h) => (h === null ? '' : String(h).trim())), rows });
  }
  const text = decodeText(buf);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t', '|'].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ',',
  );
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' });
  const [head = [], ...rows] = parsed.data;
  return checkShape({
    headers: head.map((h) => String(h).trim()),
    rows: rows.map((r) => r.map((c) => (c === '' ? null : c))),
  });
}

// ───────────── Row validation ─────────────

export interface StudentRecord {
  row: number;
  matricule: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string | null;
  phone: string | null;
  program: string | null;
  level: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | null;
  cardUid: string | null;
  photoUrl: string | null;
  sourceHash: string;
}

export interface CardRecord {
  row: number;
  cardUid: string;
  matricule: string;
  batchId: string | null;
}

function columnIndex(table: Table, mapping: Record<string, string | null>) {
  const idx: Record<string, number> = {};
  table.headers.forEach((h, i) => {
    const f = mapping[h];
    if (f && idx[f] === undefined) idx[f] = i;
  });
  return idx;
}

export function missingRequired(kind: ImportKind, mapping: Record<string, string | null>): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return REQUIRED[kind].filter((f) => !mapped.has(f));
}

export function studentHash(r: Omit<StudentRecord, 'row' | 'sourceHash' | 'cardUid' | 'photoUrl'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        r.matricule,
        r.firstName,
        r.lastName,
        r.dateOfBirth,
        r.email,
        r.phone,
        r.program,
        r.level,
        r.status,
      ]),
    )
    .digest('hex');
}

export function validateStudents(
  table: Table,
  mapping: Record<string, string | null>,
  opts: { photoHosts: string[] } = { photoHosts: [] },
): { records: StudentRecord[]; issues: Issue[] } {
  const idx = columnIndex(table, mapping);
  const issues: Issue[] = [];
  const records: StudentRecord[] = [];
  const seen = new Set<string>();
  const text = (row: Cell[], f: string): string | null => {
    const i = idx[f];
    if (i === undefined) return null;
    const v = row[i];
    if (v === null || v === undefined) return null;
    const s = v instanceof Date ? v.toISOString() : String(v).trim();
    return s === '' ? null : s;
  };
  table.rows.forEach((row, n) => {
    const rowNo = n + 2; // 1-based + header row
    const errs: Issue[] = [];
    const add = (field: string | null, message: string) => errs.push({ row: rowNo, field, message });
    for (const i of Object.values(idx)) {
      const v = row[i];
      if (typeof v === 'string' && v.length > LIMITS.maxCell)
        add(null, `A cell is longer than ${LIMITS.maxCell} characters`);
    }
    const matRaw = text(row, 'matricule');
    const matricule = matRaw ? normalizeMatricule(matRaw) : '';
    if (!matricule) add('matricule', 'Matricule is required');
    else if (!/^[A-Z0-9/-]{3,32}$/.test(matricule)) add('matricule', 'Matricule has invalid characters');
    else if (seen.has(matricule)) add('matricule', 'Duplicate matricule in this file');
    const firstName = cleanName(text(row, 'first_name') ?? '');
    const lastName = cleanName(text(row, 'last_name') ?? '');
    if (!firstName) add('first_name', 'First name is required');
    if (!lastName) add('last_name', 'Last name is required');
    const dobCell = idx.date_of_birth !== undefined ? (row[idx.date_of_birth] ?? null) : null;
    const dateOfBirth = parseDate(typeof dobCell === 'string' ? dobCell.trim() : dobCell);
    const year = dateOfBirth ? Number(dateOfBirth.slice(0, 4)) : 0;
    if (!dateOfBirth) add('date_of_birth', 'Date of birth is missing or not a date (use dd/mm/yyyy)');
    else if (year < 1940 || year > new Date().getUTCFullYear() - 10)
      add('date_of_birth', 'Date of birth is not plausible');
    const emailRaw = text(row, 'email');
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) add('email', 'Email is not valid');
    const phone = normalizePhone(text(row, 'phone'));
    if (phone === 'INVALID') add('phone', 'Phone number is not valid');
    const status = parseStatus(text(row, 'status'));
    if (status === 'INVALID') add('status', 'Status must be active, inactive or suspended');
    const cardUid = normalizeUid(text(row, 'card_uid'));
    if (cardUid === 'INVALID') add('card_uid', 'Card UID must be 4–10 bytes of hex');
    const photoUrl = text(row, 'photo_url');
    if (photoUrl) {
      let ok = false;
      try {
        const u = new URL(photoUrl);
        ok = u.protocol === 'https:' && opts.photoHosts.includes(u.hostname);
      } catch {
        ok = false;
      }
      if (!ok) add('photo_url', 'Photo URL must be https on an approved host');
    }
    if (errs.length) {
      issues.push(...errs);
      return;
    }
    seen.add(matricule);
    const base = {
      matricule,
      firstName,
      lastName,
      dateOfBirth: dateOfBirth!,
      email,
      phone: phone as string | null,
      program: text(row, 'program') ? cleanName(text(row, 'program')!) : null,
      level: text(row, 'level') ? cleanName(text(row, 'level')!) : null,
      status: status as StudentRecord['status'],
    };
    records.push({ row: rowNo, ...base, cardUid: cardUid as string | null, photoUrl, sourceHash: studentHash(base) });
  });
  return { records, issues };
}

export function validateCards(
  table: Table,
  mapping: Record<string, string | null>,
): { records: CardRecord[]; issues: Issue[] } {
  const idx = columnIndex(table, mapping);
  const issues: Issue[] = [];
  const records: CardRecord[] = [];
  const seenUid = new Set<string>();
  const seenMat = new Set<string>();
  table.rows.forEach((row, n) => {
    const rowNo = n + 2;
    const get = (f: string) => {
      const i = idx[f];
      const v = i === undefined ? null : row[i];
      return v === null || v === undefined ? null : String(v).trim() || null;
    };
    const uid = normalizeUid(get('card_uid'));
    const matricule = get('matricule') ? normalizeMatricule(get('matricule')!) : '';
    if (!uid || uid === 'INVALID')
      return void issues.push({ row: rowNo, field: 'card_uid', message: 'Card UID must be 4–10 bytes of hex' });
    if (!matricule) return void issues.push({ row: rowNo, field: 'matricule', message: 'Matricule is required' });
    if (seenUid.has(uid))
      return void issues.push({ row: rowNo, field: 'card_uid', message: 'Duplicate card UID in this file' });
    if (seenMat.has(matricule))
      return void issues.push({ row: rowNo, field: 'matricule', message: 'Duplicate matricule in this file' });
    seenUid.add(uid);
    seenMat.add(matricule);
    records.push({ row: rowNo, cardUid: uid, matricule, batchId: get('batch_id') });
  });
  return { records, issues };
}
