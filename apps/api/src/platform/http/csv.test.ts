import { describe, expect, it } from 'vitest';
import { safeCell, toSafeCsv } from './csv';

describe('CSV injection defence', () => {
  it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('neutralises %j', (v) => {
    expect(safeCell(v).replace(/^"/, '')).toMatch(/^'/);
  });

  it('quotes separators and keeps accents', () => {
    expect(safeCell('Ngo Bassa, Marie-Thérèse')).toBe('"Ngo Bassa, Marie-Thérèse"');
    expect(safeCell('say "hi"')).toBe('"say ""hi"""');
    expect(toSafeCsv(['a'], [[1]])).toBe('\uFEFFa\r\n1\r\n');
  });
});
