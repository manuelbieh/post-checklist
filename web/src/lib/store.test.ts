import { describe, expect, test } from 'vitest';
import { Clock } from './hlc';
import type { Row } from './rows';
import { ListStore } from './store';
import { MemoryStorage } from './storage';

const LIST = 'brave-otter-harbor';
const A = 'rowA000000000000';
const B = 'rowB000000000000';
const C = 'rowC000000000000';
const EPOCH = 'start1';

function setup(storage = new MemoryStorage(), node = 'aaaaaaaa') {
  let now = 1000;
  const clock = new Clock(node, () => now);
  // Persistence is triggered explicitly with flush() in these tests.
  const store = new ListStore(LIST, storage, clock, { schedulePersist: () => {} });
  return {
    store,
    advance: (ms = 1) => {
      now += ms;
    },
  };
}

function remoteRow(overrides: Partial<Row> & Pick<Row, 'id' | 'pos'>): Row {
  return {
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

const names = (store: ListStore) => store.getSnapshot().rows.map((row) => row.name);

describe('ListStore edits', () => {
  test('lists new rows in the order they were added', () => {
    const { store } = setup();

    store.addRow(A, 'Borchardt');
    store.addRow(B, 'Café Einstein');

    expect(names(store)).toEqual(['Borchardt', 'Café Einstein']);
  });

  test('sets and clears marks', () => {
    const { store } = setup();
    store.addRow(A, 'Borchardt');

    store.setMark(A, 'ig', true);
    store.setMark(A, 'tt', true);
    store.setMark(A, 'tt', false);

    expect(store.getSnapshot().rows[0]).toMatchObject({ name: 'Borchardt', ig: true, tt: false });
  });

  test('deleting hides a row and restoring puts it back in its place', () => {
    const { store } = setup();
    store.addRow(A, 'A');
    store.addRow(B, 'B');
    store.addRow(C, 'C');

    store.deleteRow(B);
    expect(names(store)).toEqual(['A', 'C']);

    store.restoreRow(B);
    expect(names(store)).toEqual(['A', 'B', 'C']);
  });

  test('caps venue names at 200 characters', () => {
    const { store } = setup();

    store.addRow(A, 'x'.repeat(250));

    expect(names(store)).toEqual(['x'.repeat(200)]);
  });

  test('notifies subscribers with a new snapshot on every change', () => {
    const { store } = setup();
    const before = store.getSnapshot();
    let calls = 0;
    store.subscribe(() => calls++);

    store.addRow(A, 'A');

    expect(calls).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
  });

  test('records nothing when a value stays the same', () => {
    const { store } = setup();
    store.addRow(A, 'A');
    const snapshot = store.getSnapshot();

    store.setName(A, 'A');
    store.setMark(A, 'ig', false);
    store.restoreRow(A);

    expect(store.getSnapshot()).toBe(snapshot);
  });

  test('reports local edits, but not changes that came from the server', () => {
    const { store } = setup();
    let edits = 0;
    store.onLocalEdit(() => edits++);

    store.addRow(A, 'A');
    store.applySync([], [remoteRow({ id: B, pos: '000000000000500:00000:bbbbbbbb', name: 'B', nameTs: '000000000000500:00000:bbbbbbbb' })], 1, EPOCH);

    expect(edits).toBe(1);
  });
});

describe('ListStore sync state', () => {
  test('counts rows with changes the server has not confirmed', () => {
    const { store } = setup();
    store.addRow(A, 'A');
    store.addRow(B, 'B');
    expect(store.getSnapshot().pending).toBe(2);

    store.applySync(store.pendingRows(10), [], 1, EPOCH);
    expect(store.getSnapshot().pending).toBe(0);

    store.setMark(A, 'ig', true);
    expect(store.getSnapshot().pending).toBe(1);
    expect(store.pendingRows(10).map((row) => row.id)).toEqual([A]);
  });

  test('keeps a row pending when it was edited while its upload was in flight', () => {
    const { store, advance } = setup();
    store.addRow(A, 'Cafe');
    const sent = store.pendingRows(10);

    advance();
    store.setName(A, 'Café');
    store.applySync(sent, sent, 1, EPOCH);

    expect(names(store)).toEqual(['Café']);
    expect(store.getSnapshot().pending).toBe(1);
  });

  test('applies rows from the server, but never over a newer local edit', () => {
    const { store } = setup();
    store.addRow(A, 'Local');

    store.applySync(
      [],
      [
        remoteRow({
          id: A,
          pos: '000000000001000:00000:aaaaaaaa',
          name: 'Remote',
          nameTs: '000000000000500:00000:bbbbbbbb',
          ig: true,
          igTs: '000000000000500:00000:bbbbbbbb',
        }),
      ],
      1,
      EPOCH,
    );

    expect(store.getSnapshot().rows[0]).toMatchObject({ name: 'Local', ig: true });
    expect(store.cursor).toBe(1);
  });

  test('sorts rows from other devices by when they were created', () => {
    const { store } = setup();
    store.addRow(A, 'Mine');

    store.applySync([], [remoteRow({ id: B, pos: '000000000000500:00000:bbbbbbbb', name: 'Earlier elsewhere' })], 1, EPOCH);

    expect(names(store)).toEqual(['Earlier elsewhere', 'Mine']);
  });

  test('adds new rows after every row it has seen, even from a device whose clock is ahead', () => {
    const { store } = setup();
    store.applySync([], [remoteRow({ id: B, pos: '000000000009000:00000:bbbbbbbb', name: 'Future' })], 1, EPOCH);

    store.addRow(A, 'Now');

    expect(names(store)).toEqual(['Future', 'Now']);
  });

  test('after the server lost its data, every row is pending again', () => {
    const { store } = setup();
    store.addRow(A, 'A');
    store.applySync(store.pendingRows(10), [], 3, EPOCH);

    store.resetAcks();

    expect(store.getSnapshot().pending).toBe(1);
    expect(store.cursor).toBe(0);
  });
});

describe('ListStore persistence', () => {
  test('keeps rows, cursor and sync state across reloads', () => {
    const storage = new MemoryStorage();
    const first = setup(storage).store;
    first.addRow(A, 'Borchardt');
    first.applySync(first.pendingRows(10), [], 7, EPOCH);
    first.addRow(B, 'Not synced yet');
    first.flush();

    const second = setup(storage).store;

    expect(names(second)).toEqual(['Borchardt', 'Not synced yet']);
    expect(second.cursor).toBe(7);
    expect(second.epoch).toBe(EPOCH);
    expect(second.pendingRows(10).map((row) => row.id)).toEqual([B]);
  });

  test('a tab keeps its cursor when another tab saved one from a different server epoch', () => {
    // Mixing one epoch's cursor with another's would skip changes; each tab's next sync
    // notices a stale epoch and starts over.
    const storage = new MemoryStorage();
    const first = setup(storage, 'aaaaaaaa').store;
    const second = setup(storage, 'bbbbbbbb').store;
    first.applySync([], [], 100, 'old-start');
    second.applySync([], [], 3, 'new-start');
    second.flush();

    first.reloadFromStorage();

    expect([first.cursor, first.epoch]).toEqual([100, 'old-start']);
  });

  test('a tab that has not synced yet takes cursor and epoch from storage', () => {
    const storage = new MemoryStorage();
    const first = setup(storage, 'aaaaaaaa').store;
    const second = setup(storage, 'bbbbbbbb').store;
    first.applySync([], [], 3, EPOCH);
    first.flush();

    second.reloadFromStorage();

    expect([second.cursor, second.epoch]).toEqual([3, EPOCH]);
  });

  test('saves automatically after edits', () => {
    const storage = new MemoryStorage();
    const clock = new Clock('aaaaaaaa', () => 1000);
    const store = new ListStore(LIST, storage, clock, { schedulePersist: (persist) => persist() });

    store.addRow(A, 'Borchardt');

    expect(names(setup(storage).store)).toEqual(['Borchardt']);
  });

  test("two tabs sharing storage keep each other's edits", () => {
    const storage = new MemoryStorage();
    const tabA = setup(storage, 'tabaaaaa').store;
    const tabB = setup(storage, 'tabbbbbb').store;

    tabA.addRow(A, 'From A');
    tabA.flush();
    tabB.addRow(B, 'From B');
    tabB.flush();

    expect(names(setup(storage).store)).toEqual(['From A', 'From B']);
  });

  test('picks up edits another tab saved', () => {
    const storage = new MemoryStorage();
    const tabA = setup(storage, 'tabaaaaa').store;
    const tabB = setup(storage, 'tabbbbbb').store;
    tabA.addRow(A, 'From A');
    tabA.flush();

    tabB.reloadFromStorage();

    expect(names(tabB)).toEqual(['From A']);
  });

  test('keeps lists apart', () => {
    const storage = new MemoryStorage();
    const clock = new Clock('aaaaaaaa', () => 1000);
    const one = new ListStore('list-one', storage, clock, { schedulePersist: () => {} });
    one.addRow(A, 'Only in list one');
    one.flush();

    const two = new ListStore('list-two', storage, clock, { schedulePersist: () => {} });

    expect(two.getSnapshot().rows).toEqual([]);
  });
});

describe('ListStore import', () => {
  test('adds imported entries after the existing rows, in file order', () => {
    const { store } = setup();
    store.addRow(A, 'Existing');

    const added = store.importEntries(
      [
        { name: 'One', ig: true, tt: false },
        { name: 'Two', ig: false, tt: true },
      ],
      'append',
    );

    expect(added).toBe(2);
    expect(store.getSnapshot().rows.map(({ name, ig, tt }) => ({ name, ig, tt }))).toEqual([
      { name: 'Existing', ig: false, tt: false },
      { name: 'One', ig: true, tt: false },
      { name: 'Two', ig: false, tt: true },
    ]);
  });

  test('replacing deletes the existing rows first', () => {
    const { store } = setup();
    store.addRow(A, 'Existing');

    store.importEntries([{ name: 'One', ig: false, tt: false }], 'replace');

    expect(names(store)).toEqual(['One']);
  });
});

describe('ListStore usage', () => {
  test('a list counts as used once it has rows, even if all of them were deleted', () => {
    const { store } = setup();
    expect(store.hasRows()).toBe(false);

    store.addRow(A, 'A');
    store.deleteRow(A);

    expect(store.hasRows()).toBe(true);
  });
});

