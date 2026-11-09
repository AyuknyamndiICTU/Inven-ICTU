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
  /** Where each row came from in a multi-sheet workbook, e.g. "SEN, row 12" (used in issue messages). */
  origins?: string[];
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
  'full_name',
  'personal_email',
  'gender',
  'nationality',
  'section',
] as const;
export const CARD_FIELDS = ['card_uid', 'matricule', 'batch_id', 'printed_at'] as const;
export const REQUIRED: Record<ImportKind, string[]> = {
  /** Names: first_name + last_name, or one full_name column (see missingRequired). Date of birth is optional. */
  STUDENTS: ['matricule', 'first_name', 'last_name'],
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
  email: [
    'ict_u_email',
    'ictu_email',
    'school_email',
    'institutional_email',
    'official_email',
    'email_ictu',
    'email',
    'e_mail',
    'mail',
    'courriel',
    'adresse_email',
    'adresse_mail',
  ],
  /** A second "Email" column (after the school one) is the student's personal address. */
  personal_email: ['personal_email', 'email_personnel', 'private_email', 'other_email', 'email', 'e_mail'],
  full_name: [
    'name',
    'names',
    'full_name',
    'fullname',
    'student_name',
    'nom_complet',
    'nom_et_prenom',
    'nom_et_prenoms',
    'noms_et_prenoms',
    'noms_prenoms',
  ],
  gender: ['gender', 'sex', 'sexe', 'genre'],
  nationality: ['nationality', 'nationalite', 'citizenship'],
  section: ['section', 'language', 'langue', 'stream', 'sub_system', 'subsystem', 'sous_systeme'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'numero_de_telephone', 'phone_number', 'portable'],
  program: [
    'program',
    'programme',
    'filiere',
    'department',
    'departement',
    'field',
    'specialite',
    'course',
    'major',
    'specialty',
    'speciality',
  ],
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

/** Columns that must never be stored or shown (registrar exports sometimes include initial passwords). */
const SENSITIVE_HEADER = /(^|_)(password|passwd|pwd|mot_de_passe|mdp|pin|secret|otp|code_pin)(_|$)/;
export const isSensitiveHeader = (h: string) => SENSITIVE_HEADER.test(normalizeHeader(h));

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

/** "ENOBO NGONDI" → "Enobo Ngondi"; names already in mixed case are kept as written. */
export function displayName(s: string): string {
  const n = cleanName(s);
  if (n !== n.toLocaleUpperCase('fr')) return n;
  return n
    .toLocaleLowerCase('fr')
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('fr'));
}

/**
 * One "NAME" column, written family name first (ICTU registrar convention, e.g. "ENOBO NGONDI EMMANUELLE STELLA"):
 * the first word becomes the last name and the rest the first name(s). Enrolment matching ignores the split.
 */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const words = displayName(full).split(' ').filter(Boolean);
  if (words.length <= 1) return { firstName: words[0] ?? '', lastName: words[0] ?? '' };
  return { lastName: words[0]!, firstName: words.slice(1).join(' ') };
}

/** Matching form (ARCH §5 F7): trim, collapse whitespace, NFC, case-fold. Accents remain significant. */
export function normalizeName(s: string): string {
  return cleanName(s).toLocaleLowerCase('fr');
}

/**
 * Name match for enrolment (ARCH §5 F7). Exact first/last match, or — for registrar files that only carry one
 * full-name column, split heuristically on import — the same set of name words in any order across both fields.
 */
export function namesMatch(
  record: { firstName: string; lastName: string },
  submitted: { firstName: string; lastName: string },
): { firstName: boolean; lastName: boolean } {
  const first = normalizeName(record.firstName) === normalizeName(submitted.firstName);
  const last = normalizeName(record.lastName) === normalizeName(submitted.lastName);
  if (first && last) return { firstName: true, lastName: true };
  const words = (a: string, b: string) => normalizeName(`${a} ${b}`).split(' ').filter(Boolean).sort().join(' ');
  const same = words(record.firstName, record.lastName) === words(submitted.firstName, submitted.lastName);
  return same ? { firstName: true, lastName: true } : { firstName: first, lastName: last };
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

interface Sheet {
  name: string;
  rows: Array<{ n: number; cells: Cell[] }>;
}

const KNOWN_HEADERS = new Set(Object.values(ALIASES).flat());
const headerScore = (cells: Cell[]) =>
  cells.filter((v) => typeof v === 'string' && KNOWN_HEADERS.has(normalizeHeader(v))).length;

/**
 * One table from a workbook. A single sheet is read as-is (first row = headers). When several sheets share a
 * recognisable header row — e.g. an admissions list with one sheet per programme — all of them are combined,
 * columns are aligned by header name (a blank header takes the name of the same column in the first sheet), and a
 * "Programme" column is filled with the sheet name if the sheets have none.
 */
function mergeSheets(sheets: Sheet[]): Table {
  const located = sheets
    .map((s) => {
      const top = s.rows.slice(0, 5);
      const best = top.reduce((b, r, i) => (headerScore(r.cells) > headerScore(top[b]?.cells ?? []) ? i : b), 0);
      return { ...s, headerAt: best, score: headerScore(top[best]?.cells ?? []) };
    })
    .filter((s) => s.rows.length > 0);
  const tabular = located.filter((s) => s.score >= 2);
  if (tabular.length <= 1) {
    const s = tabular[0] ?? located[0];
    if (!s) throw Errors.badRequest('EMPTY_FILE', 'The file has no header row.');
    const [head, ...rows] = s.rows.slice(tabular[0] ? s.headerAt : 0);
    return dropSensitive(
      checkShape({
        headers: (head?.cells ?? []).map((h) => (h === null ? '' : String(h).trim())),
        rows: rows.map((r) => r.cells),
      }),
    );
  }
  const headers: string[] = [];
  const norm: string[] = [];
  const rows: Cell[][] = [];
  const origins: string[] = [];
  const first = tabular[0]!;
  const firstHead = first.rows[first.headerAt]!.cells.map((h) => (h === null ? '' : String(h).trim()));
  for (const s of tabular) {
    const head = s.rows[s.headerAt]!.cells.map((h) => (h === null ? '' : String(h).trim()));
    const lead = head.findIndex((h) => h !== '');
    const firstLead = firstHead.findIndex((h) => h !== '');
    const target = head.map((h, i) => {
      let name = h;
      if (!name) {
        const twin = firstHead[i - lead + firstLead];
        if (i >= lead - 1 && twin && !head.some((x) => normalizeHeader(x) === normalizeHeader(twin))) name = twin;
      }
      if (!name) return -1;
      const k = normalizeHeader(name);
      let at = norm.indexOf(k);
      if (at < 0) {
        headers.push(name);
        norm.push(k);
        at = headers.length - 1;
      }
      return at;
    });
    for (const r of s.rows.slice(s.headerAt + 1)) {
      const out: Cell[] = [];
      r.cells.forEach((v, i) => {
        const at = target[i];
        if (at !== undefined && at >= 0) out[at] = v;
      });
      rows.push(out);
      origins.push(`${s.name}, row ${r.n}`);
    }
  }
  const hasProgram = norm.some((k) => ALIASES.program!.includes(k));
  if (!hasProgram) {
    headers.push('Programme');
    let i = 0;
    for (const s of tabular) for (const _ of s.rows.slice(s.headerAt + 1)) rows[i++]![headers.length - 1] = s.name;
  }
  const width = headers.length;
  const table = { headers, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)), origins };
  return dropSensitive(checkShape(table));
}

/** JSON-safe copy for storage: Date cells become yyyy-mm-dd (what parseDate accepts). */
export function serializeTable(t: Table): Table {
  const cell = (v: Cell): Cell =>
    v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)) : v;
  return { ...t, rows: t.rows.map((r) => r.map(cell)) };
}

/** Removes password/PIN/secret columns so they are never stored, previewed or imported. */
function dropSensitive(table: Table): Table {
  const keep = table.headers.map((h) => !isSensitiveHeader(h));
  if (keep.every(Boolean)) return table;
  return {
    headers: table.headers.filter((_, i) => keep[i]),
    rows: table.rows.map((r) => r.filter((_, i) => keep[i])),
    ...(table.origins ? { origins: table.origins } : {}),
  };
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
    if (!wb.worksheets.length) throw Errors.badRequest('EMPTY_FILE', 'The workbook has no sheet.');
    const sheets: Sheet[] = [];
    for (const ws of wb.worksheets) {
      if (ws.rowCount > LIMITS.maxRows + 1)
        throw Errors.badRequest('TOO_MANY_ROWS', `At most ${LIMITS.maxRows} rows are allowed.`);
      const all: Array<{ n: number; cells: Cell[] }> = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        const cells = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
        if (cells.some((v) => v !== null && String(v).trim() !== '')) all.push({ n, cells });
      });
      sheets.push({ name: ws.name.trim(), rows: all });
    }
    return mergeSheets(sheets);
  }
  const text = decodeText(buf);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t', '|'].reduce(
    (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
    ',',
  );
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' });
  const [head = [], ...rows] = parsed.data;
  return dropSensitive(
    checkShape({
      headers: head.map((h) => String(h).trim()),
      rows: rows.map((r) => r.map((c) => (c === '' ? null : c))),
    }),
  );
}

// ───────────── Row validation ─────────────

export interface StudentRecord {
  row: number;
  matricule: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  personalEmail: string | null;
  phone: string | null;
  gender: string | null;
  nationality: string | null;
  section: string | null;
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
  const required =
    kind === 'STUDENTS' && mapped.has('full_name')
      ? REQUIRED.STUDENTS.filter((f) => f !== 'first_name' && f !== 'last_name')
      : REQUIRED[kind];
  return required.filter((f) => !mapped.has(f));
}

export function studentHash(r: Omit<StudentRecord, 'row' | 'sourceHash' | 'cardUid' | 'photoUrl'>): string {
  const base: unknown[] = [
    r.matricule,
    r.firstName,
    r.lastName,
    r.dateOfBirth,
    r.email,
    r.phone,
    r.program,
    r.level,
    r.status,
  ];
  // Extra registrar fields only enter the hash when present, so files without them keep their earlier hashes.
  const extra = [r.personalEmail, r.gender, r.nationality, r.section];
  return createHash('sha256')
    .update(JSON.stringify(extra.some((v) => v !== null) ? [...base, ...extra] : base))
    .digest('hex');
}

export function validateStudents(
  table: Table,
  mapping: Record<string, string | null>,
  opts: { photoHosts: string[] } = { photoHosts: [] },
): { records: StudentRecord[]; issues: Issue[]; warnings: Issue[] } {
  const idx = columnIndex(table, mapping);
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
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
  const optional = (row: Cell[], f: string) => {
    const v = text(row, f);
    return v ? cleanName(v) : null;
  };
  table.rows.forEach((row, n) => {
    const rowNo = n + 2; // 1-based + header row
    const where = table.origins?.[n] ? `${table.origins[n]}: ` : '';
    const errs: Issue[] = [];
    const add = (field: string | null, message: string) => errs.push({ row: rowNo, field, message: where + message });
    const warn = (field: string, message: string) => warnings.push({ row: rowNo, field, message: where + message });
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
    let firstName = displayName(text(row, 'first_name') ?? '');
    let lastName = displayName(text(row, 'last_name') ?? '');
    const full = text(row, 'full_name');
    if ((!firstName || !lastName) && full) {
      const split = splitFullName(full);
      firstName ||= split.firstName;
      lastName ||= split.lastName;
    }
    if (!firstName) add(idx.full_name !== undefined ? 'full_name' : 'first_name', 'First name is required');
    if (!lastName) add(idx.full_name !== undefined ? 'full_name' : 'last_name', 'Last name is required');
    const dobCell = idx.date_of_birth !== undefined ? (row[idx.date_of_birth] ?? null) : null;
    const hasDob = dobCell !== null && String(dobCell).trim() !== '';
    const dateOfBirth = hasDob ? parseDate(typeof dobCell === 'string' ? dobCell.trim() : dobCell) : null;
    const year = dateOfBirth ? Number(dateOfBirth.slice(0, 4)) : 0;
    if (hasDob && !dateOfBirth) add('date_of_birth', 'Date of birth is not a date (use dd/mm/yyyy)');
    else if (dateOfBirth && (year < 1940 || year > new Date().getUTCFullYear() - 10))
      add('date_of_birth', 'Date of birth is not plausible');
    // Contact problems never block a student: the field is left empty and reported.
    const mail = (f: string) => {
      const raw = text(row, f);
      if (!raw) return null;
      const v = raw.toLowerCase().replace(/\s+/g, '');
      if (EMAIL_RE.test(v)) return v;
      warn(f, `Email "${raw}" is not valid — imported without it`);
      return null;
    };
    let email = mail('email');
    let personalEmail = mail('personal_email');
    if (!email && personalEmail) {
      email = personalEmail;
      personalEmail = null;
    }
    if (personalEmail === email) personalEmail = null;
    let phone = normalizePhone(text(row, 'phone'));
    if (phone === 'INVALID') {
      warn('phone', `Phone number "${text(row, 'phone')}" is not valid — imported without it`);
      phone = null;
    }
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
      dateOfBirth,
      email,
      personalEmail,
      phone: phone as string | null,
      gender: optional(row, 'gender') ? displayName(optional(row, 'gender')!) : null,
      nationality: optional(row, 'nationality') ? displayName(optional(row, 'nationality')!) : null,
      section: optional(row, 'section') ? displayName(optional(row, 'section')!) : null,
      program: optional(row, 'program'),
      level: optional(row, 'level'),
      status: status as StudentRecord['status'],
    };
    records.push({ row: rowNo, ...base, cardUid: cardUid as string | null, photoUrl, sourceHash: studentHash(base) });
  });
  return { records, issues, warnings };
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
