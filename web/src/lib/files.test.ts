import { describe, expect, test } from 'vitest';
import { csvFileName, decodeText } from './files';

describe('decodeText', () => {
  test('reads UTF-8', () => {
    expect(decodeText(new TextEncoder().encode('Café Müller'))).toBe('Café Müller');
  });

  test('falls back to Windows-1252, which older Excel versions use for CSV', () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);

    expect(decodeText(bytes)).toBe('Café Müller');
  });
});

describe('csvFileName', () => {
  test('includes the local date', () => {
    expect(csvFileName(new Date(2026, 8, 7, 23, 30))).toBe('post-check-2026-09-07.csv');
  });
});
