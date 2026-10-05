import { MAX_NAME_LENGTH, type CsvEntry } from './csv';
import type { Clock } from './hlc';
import { newRowId } from './ids';
import { latestTimestamp, mergeRow, type Row } from './rows';
import type { KeyValueStorage } from './storage';

export interface ListSnapshot {
  /** Rows that are not deleted, oldest first. */
  readonly rows: readonly Row[];
  /** Rows with changes the server has not confirmed yet. */
  readonly pending: number;
}

export type Mark = 'ig' | 'tt';

interface StoreOptions {
  /** Receives a function that saves the list; called after every change. Defaults to a short debounce. */
  schedulePersist?: (persist: () => void) => void;
}

interface StoredDocument {
  v: 1;
  cursor: number;
  /** The server epoch the cursor belongs to (missing in documents saved before epochs). */
  epoch?: string;
  rows: (Row & { ackTs: string })[];
}

const PERSIST_DELAY_MS = 300;

export function dataKey(listId: string): string {
  return `postcheck:data:${listId}`;
}

/**
 * All rows of one list, kept in memory and in localStorage. Edits apply
 * instantly; the sync engine uploads pending rows and feeds server rows back
 * through applySync().
 */
export class ListStore {
  private readonly rows = new Map<string, Row>();
  /** Per row: the newest timestamp the server has confirmed. */
  private readonly acks = new Map<string, string>();
  private cursorValue = 0;
  private epochValue = '';
  private snapshot: ListSnapshot = { rows: [], pending: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly editListeners = new Set<() => void>();
  /** The JSON this store last wrote; anything else in storage came from another tab. */
  private lastWritten: string | null = null;
  private readonly schedulePersist: (persist: () => void) => void;

  constructor(
    readonly listId: string,
    private readonly storage: KeyValueStorage,
    private readonly clock: Clock,
    options: StoreOptions = {},
  ) {
    this.schedulePersist = options.schedulePersist ?? debounce(PERSIST_DELAY_MS);
    const stored = storage.getItem(dataKey(listId));
    if (stored !== null) {
      this.absorb(stored);
      this.lastWritten = stored;
    }
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot = (): ListSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called after edits made on this device (not for changes from the server). */
  onLocalEdit(listener: () => void): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  /** Whether the list was ever used: it has rows, even if they are all deleted. */
  hasRows(): boolean {
    return this.rows.size > 0;
  }

  getRow(id: string): Row | undefined {
    return this.rows.get(id);
  }

  get cursor(): number {
    return this.cursorValue;
  }

  /** The server epoch the cursor belongs to; empty before the first sync. */
  get epoch(): string {
    return this.epochValue;
  }

  addRow(id: string, name: string): void {
    if (this.rows.has(id)) {
      this.setName(id, name);
      return;
    }
    const ts = this.clock.tick();
    this.rows.set(id, {
      id,
      pos: ts,
      name: clampName(name),
      nameTs: ts,
      ig: false,
      igTs: '',
      tt: false,
      ttTs: '',
      deleted: false,
      deletedTs: '',
    });
    this.edited();
  }

  setName(id: string, name: string): void {
    const row = this.rows.get(id);
    const value = clampName(name);
    if (!row || row.name === value) return;
    this.update({ ...row, name: value, nameTs: this.clock.tick() });
  }

  setMark(id: string, mark: Mark, value: boolean): void {
    const row = this.rows.get(id);
    if (!row || row[mark] === value) return;
    const ts = this.clock.tick();
    this.update(mark === 'ig' ? { ...row, ig: value, igTs: ts } : { ...row, tt: value, ttTs: ts });
  }

  deleteRow(id: string): void {
    const row = this.rows.get(id);
    if (!row || row.deleted) return;
    this.update({ ...row, deleted: true, deletedTs: this.clock.tick() });
  }

  restoreRow(id: string): void {
    const row = this.rows.get(id);
    if (!row || !row.deleted) return;
    this.update({ ...row, deleted: false, deletedTs: this.clock.tick() });
  }

  /** Adds CSV entries after the existing rows; 'replace' deletes the existing rows first. */
  importEntries(entries: readonly CsvEntry[], mode: 'append' | 'replace'): number {
    if (mode === 'replace') {
      for (const row of this.rows.values()) {
        if (!row.deleted) this.rows.set(row.id, { ...row, deleted: true, deletedTs: this.clock.tick() });
      }
    }
    for (const entry of entries) {
      const ts = this.clock.tick();
      const id = newRowId();
      this.rows.set(id, {
        id,
        pos: ts,
        name: clampName(entry.name),
        nameTs: ts,
        ig: entry.ig,
        igTs: entry.ig ? ts : '',
        tt: entry.tt,
        ttTs: entry.tt ? ts : '',
        deleted: false,
        deletedTs: '',
      });
    }
    if (entries.length > 0 || mode === 'replace') this.edited();
    return entries.length;
  }

  /** Rows with changes the server has not confirmed, at most `limit`. */
  pendingRows(limit: number): Row[] {
    const pending: Row[] = [];
    for (const row of this.rows.values()) {
      if (pending.length >= limit) break;
      if (latestTimestamp(row) > (this.acks.get(row.id) ?? '')) pending.push(row);
    }
    return pending;
  }

  /**
   * Applies a sync response: `sent` are the rows that were uploaded, `received`
   * the rows the server returned, `cursor` the server's change counter and
   * `epoch` the server start it belongs to.
   */
  applySync(sent: readonly Row[], received: readonly Row[], cursor: number, epoch: string): void {
    let changed = cursor !== this.cursorValue || epoch !== this.epochValue;
    for (const row of sent) changed = this.ack(row.id, latestTimestamp(row)) || changed;
    for (const remote of received) {
      const remoteTs = latestTimestamp(remote);
      this.clock.observe(remoteTs);
      const local = this.rows.get(remote.id);
      const merged = local ? mergeRow(local, remote) : remote;
      if (merged !== local) {
        this.rows.set(remote.id, merged);
        changed = true;
      }
      changed = this.ack(remote.id, remoteTs) || changed;
    }
    this.cursorValue = cursor;
    this.epochValue = epoch;
    if (changed) {
      this.refresh();
      this.schedulePersist(() => this.persist());
    }
  }

  /** Marks every row as unconfirmed, for when the server lost its data. */
  resetAcks(): void {
    this.acks.clear();
    this.cursorValue = 0;
    this.refresh();
    this.schedulePersist(() => this.persist());
  }

  /** Saves to storage now. */
  flush(): void {
    this.persist();
  }

  /** Merges what another tab saved into this store. */
  reloadFromStorage(): void {
    const stored = this.storage.getItem(dataKey(this.listId));
    if (stored !== null && stored !== this.lastWritten && this.absorb(stored)) this.refresh();
  }

  private ack(id: string, ts: string): boolean {
    if (ts <= (this.acks.get(id) ?? '')) return false;
    this.acks.set(id, ts);
    return true;
  }

  private update(row: Row): void {
    this.rows.set(row.id, row);
    this.edited();
  }

  private edited(): void {
    this.refresh();
    for (const listener of this.editListeners) listener();
    this.schedulePersist(() => this.persist());
  }

  private refresh(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): ListSnapshot {
    const rows = [...this.rows.values()].filter((row) => !row.deleted).sort(compareRows);
    let pending = 0;
    for (const row of this.rows.values()) {
      if (latestTimestamp(row) > (this.acks.get(row.id) ?? '')) pending++;
    }
    return { rows, pending };
  }

  private persist(): void {
    const key = dataKey(this.listId);
    const stored = this.storage.getItem(key);
    // Another tab saved in the meantime: merge its state instead of overwriting it.
    if (stored !== null && stored !== this.lastWritten && this.absorb(stored)) this.refresh();

    const document: StoredDocument = {
      v: 1,
      cursor: this.cursorValue,
      epoch: this.epochValue,
      rows: [...this.rows.values()].map((row) => ({ ...row, ackTs: this.acks.get(row.id) ?? '' })),
    };
    const json = JSON.stringify(document);
    try {
      this.storage.setItem(key, json);
      this.lastWritten = json;
    } catch (error) {
      // Quota exceeded or storage disabled: the data stays in memory and still syncs.
      console.error('Post Check: could not save the list on this device', error);
    }
  }

  /** Merges a stored document into memory. Returns whether anything changed. */
  private absorb(json: string): boolean {
    let document: StoredDocument;
    try {
      document = JSON.parse(json) as StoredDocument;
    } catch {
      return false;
    }
    if (document?.v !== 1 || !Array.isArray(document.rows)) return false;

    let changed = false;
    for (const { ackTs, ...row } of document.rows) {
      const local = this.rows.get(row.id);
      const merged = local ? mergeRow(local, row) : row;
      if (merged !== local) {
        this.rows.set(row.id, merged);
        changed = true;
      }
      changed = this.ack(row.id, ackTs) || changed;
      this.clock.observe(latestTimestamp(merged));
    }
    // A cursor only means something together with its epoch, so the pair is taken as a
    // whole: from storage when this store hasn't synced yet, otherwise only a newer
    // cursor of the same epoch. A tab still on an old epoch finds out at its next sync.
    const epoch = document.epoch ?? '';
    if (this.epochValue === '' && epoch !== '') {
      this.epochValue = epoch;
      this.cursorValue = document.cursor;
      changed = true;
    } else if (epoch === this.epochValue && document.cursor > this.cursorValue) {
      this.cursorValue = document.cursor;
      changed = true;
    }
    return changed;
  }
}

function clampName(name: string): string {
  return name.slice(0, MAX_NAME_LENGTH);
}

function compareRows(a: Row, b: Row): number {
  if (a.pos !== b.pos) return a.pos < b.pos ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function debounce(ms: number): (fn: () => void) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (fn) => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
