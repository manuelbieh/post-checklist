export interface CsvEntry {
  name: string;
  ig: boolean;
  tt: boolean;
}

export const MAX_NAME_LENGTH = 200;

const HEADER = ['No', 'Venue', 'Instagram', 'TikTok'];

/** CSV for Excel, Numbers and Google Sheets: UTF-8 with BOM, comma separated, CRLF line ends. */
export function toCsv(rows: readonly CsvEntry[]): string {
  const lines = [
    HEADER,
    ...rows.map((row, index) => [String(index + 1), row.name, row.ig ? 'y' : 'n', row.tt ? 'y' : 'n']),
  ];
  return '﻿' + lines.map((cells) => cells.map(quote).join(',')).join('\r\n') + '\r\n';
}

function quote(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Parses CSV (RFC 4180) separated by commas, semicolons or tabs, whichever the first line uses. */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
    } else if (quoted) {
      continue;
    } else if (char === '\n' || char === '\r') {
      if (Object.values(counts).some((count) => count > 0)) break;
    } else if (char in counts) {
      counts[char]!++;
    }
  }
  let best = ',';
  for (const [delimiter, count] of Object.entries(counts)) {
    if (count > counts[best]!) best = delimiter;
  }
  return best;
}

type Column = 'no' | 'venue' | 'ig' | 'tt';

// Header names after lowercasing and dropping everything but letters, digits and #.
const HEADER_NAMES: Record<Column, readonly string[]> = {
  no: ['no', 'nr', '#', 'number', 'nummer', 'num'],
  venue: ['venue', 'venuename', 'name', 'restaurant', 'restaurantbar', 'location', 'lokal', 'bar', 'place', 'ort', 'spot'],
  ig: ['instagram', 'insta', 'ig'],
  tt: ['tiktok', 'tt'],
};

const CHECKED = new Set(['y', 'yes', 'x', '1', 'true', 'ja', 'j', '✓', '✔', '✅']);

function columnFor(cell: string): Column | undefined {
  const key = cell
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9#]/g, '');
  return (Object.keys(HEADER_NAMES) as Column[]).find((column) => HEADER_NAMES[column].includes(key));
}

function isChecked(value: string | undefined): boolean {
  return value !== undefined && CHECKED.has(value.trim().toLowerCase());
}

/**
 * Reads venues from a CSV file: our own export, a spreadsheet with its own
 * header names (English or German, any column order), or plain columns
 * without a header.
 */
export function csvToEntries(text: string): CsvEntry[] {
  const table = parseCsv(text);
  const first = table[0];
  if (!first) return [];

  const headerColumns = first.map(columnFor);
  const recognized = headerColumns.filter(Boolean).length;
  const hasHeader = recognized >= 2 || (first.length === 1 && recognized === 1);

  let columns: (Column | undefined)[];
  let body: string[][];
  if (hasHeader) {
    columns = headerColumns;
    if (!columns.includes('venue')) {
      const unnamed = columns.indexOf(undefined);
      if (unnamed >= 0) columns[unnamed] = 'venue';
    }
    body = table.slice(1);
  } else {
    const numbered = first.length > 1 && /^\d+$/.test(first[0]!.trim());
    columns = numbered ? ['no', 'venue', 'ig', 'tt'] : ['venue', 'ig', 'tt'];
    body = table;
  }

  const venueAt = columns.indexOf('venue');
  const igAt = columns.indexOf('ig');
  const ttAt = columns.indexOf('tt');
  const entries: CsvEntry[] = [];
  for (const cells of body) {
    const name = (cells[venueAt] ?? '').trim().slice(0, MAX_NAME_LENGTH);
    const ig = isChecked(cells[igAt]);
    const tt = isChecked(cells[ttAt]);
    if (name !== '' || ig || tt) entries.push({ name, ig, tt });
  }
  return entries;
}
