import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  autoMap,
  normalizeName,
  normalizeUid,
  parseDate,
  parseTable,
  validateStudents,
  zipInflatedSize,
} from './parse';

/** Minimal ZIP whose central directory claims `claimed` uncompressed bytes (nothing is actually compressed). */
function fakeZip(claimed: number) {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(claimed, 24);
  central.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, name, eocd]);
}

describe('directory parsing (ARCH §9)', () => {
  it('matches names case- and space-insensitively but keeps accents significant', () => {
    expect(normalizeName('  AWA   ngo ')).toBe(normalizeName('awa Ngo'));
    expect(normalizeName('Thérèse')).not.toBe(normalizeName('Therese'));
    expect(normalizeName('Thérèse')).toBe(normalizeName('THÉRÈSE'));
    // NFD input (combining accents) equals NFC input.
    expect(normalizeName('The\u0301re\u0300se')).toBe(normalizeName('Thérèse'));
  });

  it('parses French dates, ISO dates and Excel serials; rejects impossible dates', () => {
    expect(parseDate('02/03/2004')).toBe('2004-03-02');
    expect(parseDate('2004-03-02')).toBe('2004-03-02');
    expect(parseDate('2.3.2004')).toBe('2004-03-02');
    expect(parseDate(36526)).toBe('2000-01-01');
    expect(parseDate('45000')).toBe('2023-03-15');
    expect(parseDate('31/02/2004')).toBeNull();
    expect(parseDate('hier')).toBeNull();
  });

  it('normalises card UIDs', () => {
    expect(normalizeUid('04:a1:b2:c3')).toBe('04A1B2C3');
    expect(normalizeUid('04 A1 B2 C3 D4 E5 80')).toBe('04A1B2C3D4E580');
    expect(normalizeUid('XYZ')).toBe('INVALID');
  });

  it('reads a French semicolon CSV with BOM and maps French headers', async () => {
    const csv =
      '\uFEFFMatricule;Prénom;Nom;Date de naissance;Téléphone;Filière\r\nICTU001;Awa;Ngo Bassa;02/03/2004;699 12 34 12;Réseaux\r\n';
    const table = await parseTable(Buffer.from(csv, 'utf8'));
    expect(table.headers).toEqual(['Matricule', 'Prénom', 'Nom', 'Date de naissance', 'Téléphone', 'Filière']);
    const mapping = autoMap(table.headers, 'STUDENTS');
    expect(mapping).toMatchObject({
      Matricule: 'matricule',
      Prénom: 'first_name',
      Nom: 'last_name',
      'Date de naissance': 'date_of_birth',
      Téléphone: 'phone',
      Filière: 'program',
    });
    const { records, issues } = validateStudents(table, mapping);
    expect(issues).toEqual([]);
    expect(records[0]).toMatchObject({
      matricule: 'ICTU001',
      dateOfBirth: '2004-03-02',
      phone: '+237699123412',
      program: 'Réseaux',
    });
  });

  it('falls back to Latin-1 for Excel "CSV (Windows)" exports', async () => {
    const table = await parseTable(
      Buffer.from('matricule,first_name,last_name,date_of_birth\nICTU002,Hélène,Mbarga,01/01/2003\n', 'latin1'),
    );
    expect(table.rows[0]![1]).toBe('Hélène');
  });

  it('reads XLSX with real date cells and serial numbers; formulas give their cached value', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Students');
    ws.addRow(['matricule', 'first_name', 'last_name', 'date_of_birth', 'level']);
    ws.addRow(['ICTU010', 'Paul', 'Biya', new Date(Date.UTC(2003, 4, 20)), 'L1']);
    ws.addRow(['ICTU011', 'Marie', 'Atangana', 36526, { formula: '1+1', result: 2 }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const table = await parseTable(buf);
    const { records, issues } = validateStudents(table, autoMap(table.headers, 'STUDENTS'));
    expect(issues).toEqual([]);
    expect(records.map((r) => [r.dateOfBirth, r.level])).toEqual([
      ['2003-05-20', 'L1'],
      ['2000-01-01', '2'],
    ]);
  });

  it('refuses zip bombs before inflating anything', async () => {
    expect(zipInflatedSize(fakeZip(1000))).toBe(1000);
    await expect(parseTable(fakeZip(200 * 1024 * 1024))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('reports duplicates, missing fields and bad values per row', async () => {
    const csv = [
      'matricule,first_name,last_name,date_of_birth,email,status',
      'ICTU020,Awa,Ngo,02/03/2004,awa@x.cm,active',
      'ictu020,Awa,Ngo,02/03/2004,,',
      '=HYPERLINK("x"),Eve,Hack,02/03/2004,,',
      'ICTU021,,Nkemelu,31/02/2004,not-an-email,graduated',
      'ICTU022,Jean,Kamga,02/03/2004,,expelled',
    ].join('\n');
    const table = await parseTable(Buffer.from(csv));
    const { records, issues } = validateStudents(table, autoMap(table.headers, 'STUDENTS'));
    expect(records.map((r) => r.matricule)).toEqual(['ICTU020']);
    expect(issues).toEqual(
      expect.arrayContaining([
        { row: 3, field: 'matricule', message: 'Duplicate matricule in this file' },
        { row: 4, field: 'matricule', message: 'Matricule has invalid characters' },
        { row: 5, field: 'first_name', message: 'First name is required' },
        expect.objectContaining({ row: 5, field: 'date_of_birth' }),
        expect.objectContaining({ row: 5, field: 'email' }),
        expect.objectContaining({ row: 6, field: 'status' }),
      ]),
    );
  });

  it('rejects files that are not tables', async () => {
    await expect(parseTable(Buffer.from(''))).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(
      parseTable(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)])),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });

  it('enforces the row and column caps', async () => {
    const rows = 'matricule\n' + 'X\n'.repeat(100_001);
    await expect(parseTable(Buffer.from(rows))).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
    const wide = Array.from({ length: 61 }, (_, i) => `c${i}`).join(',');
    await expect(parseTable(Buffer.from(`${wide}\n`))).rejects.toMatchObject({ code: 'TOO_MANY_COLUMNS' });
  });

  it('treats full names the way the school writes them', () => {
    expect(normalizeName('Ngo Bassa  Marie-Thérèse')).toBe(normalizeName('NGO BASSA MARIE-THÉRÈSE'));
  });
});
