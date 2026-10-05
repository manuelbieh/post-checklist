import { describe, expect, test } from 'vitest';
import { latestTimestamp, mergeRow, type Row } from './rows';

const t1 = '001790000000001:00000:aaaaaaaa';
const t2 = '001790000000002:00000:aaaaaaaa';
const t3 = '001790000000002:00001:bbbbbbbb';

function row(overrides: Partial<Row>): Row {
  return {
    id: 'rowA000000000000',
    pos: t1,
    name: '',
    nameTs: '',
    ig: false,
    igTs: '',
    tt: false,
    ttTs: '',
    deleted: false,
    deletedTs: '',
    ...overrides,
  };
}

describe('mergeRow', () => {
  test('takes each field from whichever side changed it last', () => {
    const local = row({ name: 'Borchardt', nameTs: t2, ig: true, igTs: t1, deleted: true, deletedTs: t2 });
    const remote = row({
      name: 'Borchard',
      nameTs: t1,
      ig: false,
      igTs: t3,
      tt: true,
      ttTs: t2,
      deleted: false,
      deletedTs: t3,
    });

    expect(mergeRow(local, remote)).toEqual(
      row({ name: 'Borchardt', nameTs: t2, ig: false, igTs: t3, tt: true, ttTs: t2, deleted: false, deletedTs: t3 }),
    );
  });

  test('gives the same result in either direction', () => {
    const a = row({ pos: t1, name: 'A', nameTs: t3, ig: true, igTs: t1 });
    const b = row({ pos: t2, name: 'B', nameTs: t2, ig: false, igTs: t2 });

    expect(mergeRow(a, b)).toEqual(mergeRow(b, a));
  });

  test('keeps the earliest position', () => {
    expect(mergeRow(row({ pos: t2 }), row({ pos: t1 })).pos).toBe(t1);
  });

  test('returns the local row itself when the remote row has nothing newer', () => {
    const local = row({ name: 'Borchardt', nameTs: t2 });

    expect(mergeRow(local, row({ name: 'Old', nameTs: t1 }))).toBe(local);
  });
});

describe('latestTimestamp', () => {
  test('is the newest of the position and all field timestamps', () => {
    expect(latestTimestamp(row({ pos: t1, nameTs: t1, igTs: t2, ttTs: t3 }))).toBe(t3);
  });
});
