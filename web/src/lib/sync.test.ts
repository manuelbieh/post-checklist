import { describe, expect, test } from 'vitest';
import { Clock } from './hlc';
import { mergeRow, type Row } from './rows';
import { ListStore } from './store';
import { SyncEngine } from './sync';
import { MemoryStorage } from './storage';

const LIST = 'brave-otter-harbor';
const A = 'rowA000000000000';
const B = 'rowB000000000000';

let serverStarts = 0;

/** In-memory stand-in for the Go sync endpoint: same merge rule, same seq and epoch semantics. */
class FakeServer {
  seq = 0;
  requests = 0;
  /** Like the Go server, a new epoch on every start. */
  readonly epoch = `start${++serverStarts}`;
  readonly entries = new Map<string, { row: Row; seq: number }>();
  beforeRespond: (() => void) | undefined;

  /** A server started from a backup of another server's database. */
  static restoredFrom(backup: FakeServer): FakeServer {
    const server = new FakeServer();
    server.seq = backup.seq;
    for (const [id, entry] of backup.entries) server.entries.set(id, { ...entry });
    return server;
  }

  handle(url: string, init: RequestInit | undefined): Response {
    this.requests++;
    expect(url).toBe(`/api/lists/${LIST}/sync`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as { since: number; epoch?: string; rows: Row[] };

    let changed = false;
    for (const row of body.rows) {
      const existing = this.entries.get(row.id)?.row;
      const merged = existing ? mergeRow(existing, row) : row;
      if (merged !== existing) {
        this.entries.set(row.id, { row: merged, seq: this.seq + 1 });
        changed = true;
      }
    }
    if (changed) this.seq++;
    const since = body.epoch !== this.epoch || body.since > this.seq ? 0 : body.since;
    this.beforeRespond?.();
    const rows = [...this.entries.values()].filter((entry) => entry.seq > since).map((entry) => entry.row);
    return Response.json({ epoch: this.epoch, seq: this.seq, rows });
  }

  names() {
    return [...this.entries.values()].map((entry) => entry.row.name);
  }
}

function device(server: FakeServer, node: string, options: { batchSize?: number } = {}) {
  let now = 1000;
  const clock = new Clock(node, () => now);
  const store = new ListStore(LIST, new MemoryStorage(), clock, { schedulePersist: () => {} });
  const state = { online: true, server };
  const engine = new SyncEngine(store, {
    fetch: async (url, init) => {
      if (!state.online) throw new TypeError('Failed to fetch');
      return state.server.handle(String(url), init);
    },
    isOnline: () => state.online,
    batchSize: options.batchSize,
  });
  return {
    store,
    engine,
    state,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const visible = (store: ListStore) => store.getSnapshot().rows.map(({ name, ig, tt }) => ({ name, ig, tt }));

describe('SyncEngine', () => {
  test('uploads local rows and marks them as synced', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000');
    phone.store.addRow(A, 'Borchardt');

    expect(await phone.engine.sync()).toBe(true);

    expect(server.names()).toEqual(['Borchardt']);
    expect(phone.store.getSnapshot().pending).toBe(0);
    expect(phone.engine.getState().status).toBe('synced');
  });

  test('downloads rows created on another device', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000');
    const laptop = device(server, 'laptop00');
    phone.store.addRow(A, 'Borchardt');
    await phone.engine.sync();

    await laptop.engine.sync();

    expect(visible(laptop.store)).toEqual([{ name: 'Borchardt', ig: false, tt: false }]);
  });

  test('merges edits two devices made while offline', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000');
    const laptop = device(server, 'laptop00');
    phone.store.addRow(A, 'Cafe');
    phone.store.addRow(B, 'Borchardt');
    await phone.engine.sync();
    await laptop.engine.sync();

    phone.state.online = false;
    laptop.state.online = false;
    phone.advance(10);
    phone.store.setName(A, 'Café Einstein'); // t=1010
    laptop.advance(20);
    laptop.store.setMark(A, 'tt', true); // t=1020
    phone.advance(10);
    phone.store.setMark(B, 'ig', true); // t=1020
    laptop.advance(20);
    laptop.store.setName(B, 'Borchardt Mitte'); // t=1040
    phone.advance(40);
    phone.store.setName(B, 'Restaurant Borchardt'); // t=1060, the later rename wins
    expect(await phone.engine.sync()).toBe(false);
    expect(phone.engine.getState().status).toBe('offline');

    phone.state.online = true;
    laptop.state.online = true;
    await phone.engine.sync();
    await laptop.engine.sync();
    await phone.engine.sync();

    const expected = [
      { name: 'Café Einstein', ig: false, tt: true },
      { name: 'Restaurant Borchardt', ig: true, tt: false },
    ];
    expect(visible(phone.store)).toEqual(expected);
    expect(visible(laptop.store)).toEqual(expected);
    expect(phone.store.getSnapshot().pending + laptop.store.getSnapshot().pending).toBe(0);
  });

  test('an edit made while a sync is in flight stays pending and goes out next time', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000');
    phone.store.addRow(A, 'Cafe');
    server.beforeRespond = () => {
      server.beforeRespond = undefined;
      phone.advance(1);
      phone.store.setName(A, 'Café');
    };

    await phone.engine.sync();
    expect(phone.store.getSnapshot().pending).toBe(1);

    await phone.engine.sync();
    expect(server.names()).toEqual(['Café']);
    expect(phone.store.getSnapshot().pending).toBe(0);
  });

  test('reports an error with the server message when a request is rejected', async () => {
    const store = new ListStore(LIST, new MemoryStorage(), new Clock('phone000', () => 1000), {
      schedulePersist: () => {},
    });
    const engine = new SyncEngine(store, {
      fetch: async () => Response.json({ error: 'row 0: invalid id' }, { status: 400 }),
      isOnline: () => true,
    });
    store.addRow(A, 'Borchardt');

    expect(await engine.sync()).toBe(false);

    expect(engine.getState()).toMatchObject({ status: 'error', error: 'row 0: invalid id' });
    expect(store.getSnapshot().pending).toBe(1);
  });

  test('uploads everything again when the server lost its data', async () => {
    const phone = device(new FakeServer(), 'phone000');
    phone.store.addRow(A, 'Borchardt');
    await phone.engine.sync();

    const restored = new FakeServer();
    phone.state.server = restored;
    await phone.engine.sync();

    expect(restored.names()).toEqual(['Borchardt']);
  });

  test('after the server restarts from a backup, a device that was away gets everything and uploads its rows again', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000');
    const laptop = device(server, 'laptop00');
    phone.store.addRow(A, 'Borchardt');
    await phone.engine.sync();
    await laptop.engine.sync();
    const backup = FakeServer.restoredFrom(server);
    // Uploaded after the backup, so the restore loses it; only the phone still has it.
    phone.store.addRow(B, 'Grill Royal');
    await phone.engine.sync();

    // The laptop keeps working with the restored server and pushes its change counter
    // past the phone's cursor before the phone is back.
    const restored = FakeServer.restoredFrom(backup);
    phone.state.server = restored;
    laptop.state.server = restored;
    for (const [id, name] of [['rowC000000000000', 'Cordobar'], ['rowD000000000000', 'Dóttir']]) {
      laptop.store.addRow(id!, name!);
      await laptop.engine.sync();
    }
    expect(restored.seq).toBeGreaterThan(phone.store.cursor);

    await phone.engine.sync();

    expect(visible(phone.store).map((row) => row.name).sort()).toEqual(['Borchardt', 'Cordobar', 'Dóttir', 'Grill Royal']);
    expect(restored.names().sort()).toEqual(['Borchardt', 'Cordobar', 'Dóttir', 'Grill Royal']);
  });

  test('sends large uploads in batches', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000', { batchSize: 2 });
    for (let i = 0; i < 5; i++) phone.store.addRow(`row${i}000000000000`, `Venue ${i}`);

    await phone.engine.sync();

    expect(server.entries.size).toBe(5);
    expect(server.requests).toBe(3);
    expect(phone.store.getSnapshot().pending).toBe(0);
  });

  test('a sync requested while one is running is folded into it', async () => {
    const server = new FakeServer();
    const phone = device(server, 'phone000');
    phone.store.addRow(A, 'A');

    const results = await Promise.all([phone.engine.sync(), phone.engine.sync()]);

    expect(results).toEqual([true, true]);
    expect(server.requests).toBe(2);
  });
});
