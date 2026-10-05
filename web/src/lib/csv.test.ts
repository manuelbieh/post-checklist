import { describe, expect, test } from 'vitest';
import { csvToEntries, parseCsv, toCsv } from './csv';

describe('toCsv', () => {
  test('writes a header, row numbers and y/n values, with a BOM and CRLF line ends', () => {
    const csv = toCsv([
      { name: 'Café Einstein', ig: true, tt: false },
      { name: 'Borchardt', ig: false, tt: true },
    ]);

    expect(csv).toBe('﻿No,Venue,Instagram,TikTok\r\n1,Café Einstein,y,n\r\n2,Borchardt,n,y\r\n');
  });

  test('quotes names containing commas, quotes, line breaks or outer spaces', () => {
    const csv = toCsv([
      { name: 'Bar "Zur Linde", Mitte', ig: false, tt: false },
      { name: 'Two\nlines', ig: false, tt: false },
      { name: ' Spaced ', ig: false, tt: false },
    ]);

    expect(csv).toBe(
      '﻿No,Venue,Instagram,TikTok\r\n1,"Bar ""Zur Linde"", Mitte",n,n\r\n2,"Two\nlines",n,n\r\n3," Spaced ",n,n\r\n',
    );
  });
});

describe('parseCsv', () => {
  test('splits comma separated lines', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('detects semicolons, as written by German Excel', () => {
    expect(parseCsv('No;Venue;Instagram;TikTok\r\n1;Bar, Mitte;x;\r\n')).toEqual([
      ['No', 'Venue', 'Instagram', 'TikTok'],
      ['1', 'Bar, Mitte', 'x', ''],
    ]);
  });

  test('detects tabs', () => {
    expect(parseCsv('Venue\tInstagram\nCafé\ty\n')).toEqual([
      ['Venue', 'Instagram'],
      ['Café', 'y'],
    ]);
  });

  test('handles quoted delimiters, escaped quotes and line breaks', () => {
    expect(parseCsv('"Bar ""Zur Linde"", Mitte","Two\r\nlines"\n')).toEqual([['Bar "Zur Linde", Mitte', 'Two\r\nlines']]);
  });

  test('strips a byte order mark and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n\n\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvToEntries', () => {
  test('reads its own export', () => {
    const entries = [
      { name: 'Café Einstein', ig: true, tt: false },
      { name: 'Bar "X", Mitte', ig: false, tt: true },
    ];

    expect(csvToEntries(toCsv(entries))).toEqual(entries);
  });

  test('maps columns by German and short header names, in any order', () => {
    expect(csvToEntries('TT;Insta;Location;Nr\nja;;Borchardt;1\n;x;Café Einstein;2\n')).toEqual([
      { name: 'Borchardt', ig: false, tt: true },
      { name: 'Café Einstein', ig: true, tt: false },
    ]);
  });

  test('without a header, reads No, Venue, Instagram, TikTok when the first column holds numbers', () => {
    expect(csvToEntries('1,Borchardt,y,n\n2,Café Einstein,n,y\n')).toEqual([
      { name: 'Borchardt', ig: true, tt: false },
      { name: 'Café Einstein', ig: false, tt: true },
    ]);
  });

  test('without a header or numbers, reads Venue, Instagram, TikTok', () => {
    expect(csvToEntries('Borchardt,y,n\nCafé Einstein\n')).toEqual([
      { name: 'Borchardt', ig: true, tt: false },
      { name: 'Café Einstein', ig: false, tt: false },
    ]);
  });

  test.each(['y', 'Yes', 'x', 'X', '1', 'true', 'ja', 'J', '✓', '✔', '✅'])('treats %s as checked', (value) => {
    expect(csvToEntries(`Venue,Instagram\nBorchardt,${value}\n`)).toEqual([{ name: 'Borchardt', ig: true, tt: false }]);
  });

  test.each(['n', 'no', 'nein', '0', 'false', '', '-'])('treats "%s" as not checked', (value) => {
    expect(csvToEntries(`Venue,Instagram\nBorchardt,${value}\n`)).toEqual([{ name: 'Borchardt', ig: false, tt: false }]);
  });

  test('skips numbered rows that are empty', () => {
    expect(csvToEntries('No,Venue,Instagram,TikTok\n1,Borchardt,y,n\n2,,,\n3,,n,n\n')).toEqual([
      { name: 'Borchardt', ig: true, tt: false },
    ]);
  });

  test('trims names and caps them at 200 characters', () => {
    expect(csvToEntries(`Venue\n  ${'x'.repeat(250)}  \n`)).toEqual([{ name: 'x'.repeat(200), ig: false, tt: false }]);
  });
});
