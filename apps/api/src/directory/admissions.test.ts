import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  autoMap,
  displayName,
  missingRequired,
  namesMatch,
  parseTable,
  splitFullName,
  validateStudents,
} from './parse';

const HEAD = [
  'MATRICULE',
  'NAME',
  'GENDER',
  'NATIONALITY',
  'ICT-U EMAIL',
  'EMAIL',
  'PASSWORD',
  'PHONE NUMBER',
  'SECTION ',
  'FILE STATUS',
];

/** Synthetic workbook shaped like the registrar's admissions list: one sheet per programme. */
async function admissionsWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sen = wb.addWorksheet('SEN');
  sen.addRow(HEAD);
  sen.addRow([
    'ICTU20269001',
    'MBALLA ONANA JEANNE CLAIRE',
    'FEMALE',
    'CAMEROONIAN',
    'mballa.onana@ictuniversity.edu.cm',
    'jeanne@example.com',
    'Secret@2026',
    670000001,
    'English',
    'complete',
  ]);
  sen.addRow([
    'ICTU20269002',
    'TABI AKO PAUL',
    'MALE',
    'CAMEROONIAN',
    null,
    'paul.tabi@example.com',
    'Pw@2026',
    'not a phone',
    'French',
    'incomplete',
  ]);
  // Spreadsheet padding: formatted but empty rows must not count as students.
  sen.getRow(40).getCell(1).value = null;
  const cyber = wb.addWorksheet('CYBER');
  cyber.addRow([' ', ...HEAD.slice(1)]); // blank matricule header, as in the real file
  cyber.addRow(['ICTU20269003', 'NGO BIYONG ESTHER', 'FEMALE', 'CAMEROONIAN', 'ngo.biyong@ictuniversity.edu.cm']);
  const robotics = wb.addWorksheet('ROBOTICS');
  robotics.addRow([null, null, ...HEAD]); // header only, shifted right
  wb.addWorksheet('MBA');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('admissions list import (one sheet per programme)', () => {
  it('combines the sheets, drops passwords and fills the programme from the sheet name', async () => {
    const table = await parseTable(await admissionsWorkbook());
    expect(table.headers).not.toContain('PASSWORD');
    expect(table.headers).toContain('Programme');
    expect(table.rows).toHaveLength(3);
    expect(JSON.stringify(table)).not.toContain('Secret@2026');
    expect(table.origins).toEqual(['SEN, row 2', 'SEN, row 3', 'CYBER, row 2']);
    const mapping = autoMap(table.headers, 'STUDENTS');
    expect(mapping).toMatchObject({
      MATRICULE: 'matricule',
      NAME: 'full_name',
      'ICT-U EMAIL': 'email',
      EMAIL: 'personal_email',
      GENDER: 'gender',
      NATIONALITY: 'nationality',
      SECTION: 'section',
      Programme: 'program',
    });
    expect(missingRequired('STUDENTS', mapping)).toEqual([]);

    const { records, issues, warnings } = validateStudents(table, mapping);
    expect(issues).toEqual([]);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      matricule: 'ICTU20269001',
      lastName: 'Mballa',
      firstName: 'Onana Jeanne Claire',
      email: 'mballa.onana@ictuniversity.edu.cm',
      personalEmail: 'jeanne@example.com',
      phone: '+237670000001',
      dateOfBirth: null,
      gender: 'Female',
      nationality: 'Cameroonian',
      section: 'English',
      program: 'SEN',
    });
    // No ICT-U address: the personal one becomes the contact; a bad phone is reported, not fatal.
    expect(records[1]).toMatchObject({ email: 'paul.tabi@example.com', personalEmail: null, phone: null });
    expect(warnings).toEqual([
      expect.objectContaining({ field: 'phone', message: expect.stringMatching(/^SEN, row 3: /) }),
    ]);
    expect(records[2]).toMatchObject({ matricule: 'ICTU20269003', program: 'CYBER', lastName: 'Ngo' });
  });

  it('formats and splits full names, and matches them in any order at enrolment', () => {
    expect(displayName('ENOBO NGONDI EMMANUELLE-STELLA')).toBe('Enobo Ngondi Emmanuelle-Stella');
    expect(displayName('Jean de la Fontaine')).toBe('Jean de la Fontaine');
    expect(splitFullName('TABI AKO PAUL')).toEqual({ lastName: 'Tabi', firstName: 'Ako Paul' });
    const record = { firstName: 'Ako Paul', lastName: 'Tabi' };
    expect(namesMatch(record, { firstName: 'Paul', lastName: 'Tabi Ako' })).toEqual({
      firstName: true,
      lastName: true,
    });
    expect(namesMatch(record, { firstName: 'PAUL AKO', lastName: 'tabi' })).toEqual({
      firstName: true,
      lastName: true,
    });
    expect(namesMatch(record, { firstName: 'Paul', lastName: 'Tabi' })).toEqual({ firstName: false, lastName: true });
  });
});
