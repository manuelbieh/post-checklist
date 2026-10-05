import type { Row } from './rows';
import type { ListStore } from './store';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncState {
  readonly status: SyncStatus;
  /** When the last successful sync finished (ms since epoch). */
  readonly lastSyncedAt: number | null;
  /** Why the last sync failed. */
  readonly error: string | null;
}

interface SyncOptions {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  isOnline?: () => boolean;
  now?: () => number;
  /** Rows per request; the server accepts up to 1000. */
  batchSize?: number;
  requestTimeoutMs?: number;
}

interface SyncResponse {
  /** Changes on every server start; a different epoch voids this device's cursor. */
  epoch: string;
  seq: number;
  rows: Row[];
}

const MAX_ROUNDS = 50;
const EDIT_DELAY_MS = 800;
const POLL_INTERVAL_MS = 15_000;
const MAX_RETRY_DELAY_MS = 60_000;

/** Exchanges a list's changes with the server. See docs/design.md for the protocol. */
export class SyncEngine {
  private state: SyncState = { status: 'idle', lastSyncedAt: null, error: null };
  private readonly listeners = new Set<() => void>();
  private running: Promise<boolean> | null = null;
  private again = false;
  private failures = 0;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;
  private readonly batchSize: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly store: ListStore,
    options: SyncOptions = {},
  ) {
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
    this.now = options.now ?? Date.now;
    this.batchSize = options.batchSize ?? 500;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  getState = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Runs a full sync. A call while one is running is folded into it. Resolves to whether it succeeded. */
  sync(): Promise<boolean> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Syncs after `delayMs`, restarting the wait on every call. */
  schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delayMs);
  }

  /** Wires the engine to the browser: edits, connectivity, visibility, polling. Returns a stop function. */
  start(): () => void {
    this.started = true;
    const syncNow = () => void this.sync();
    const onOffline = () => this.setState({ ...this.state, status: 'offline' });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    window.addEventListener('online', syncNow);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    const stopEdits = this.store.onLocalEdit(() => this.schedule(EDIT_DELAY_MS));
    const interval = setInterval(onVisibility, POLL_INTERVAL_MS);
    syncNow();

    return () => {
      this.started = false;
      window.removeEventListener('online', syncNow);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      stopEdits();
      clearInterval(interval);
      clearTimeout(this.timer);
    };
  }

  private async run(): Promise<boolean> {
    this.setState({ ...this.state, status: 'syncing' });
    try {
      let rounds = 0;
      do {
        this.again = false;
        const since = this.store.cursor;
        const epoch = this.store.epoch;
        const batch = this.store.pendingRows(this.batchSize);
        const response = await this.post(since, epoch, batch);
        // A device that never synced has no cursor to lose.
        const restarted = response.epoch !== epoch && (epoch !== '' || since > 0);
        if (restarted || response.seq < since) {
          // The server restarted since the last sync, maybe from a backup that lacks rows this
          // device uploaded before. It sent all its rows; send all of this device's rows back.
          this.store.resetAcks();
          this.again = true;
        }
        this.store.applySync(batch, response.rows, response.seq, response.epoch);
        if (batch.length === this.batchSize) this.again = true;
      } while (this.again && ++rounds < MAX_ROUNDS);

      this.failures = 0;
      this.setState({ status: 'synced', lastSyncedAt: this.now(), error: null });
      return true;
    } catch (error) {
      this.failures++;
      this.setState({
        ...this.state,
        status: this.isOnline() ? 'error' : 'offline',
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.started) this.schedule(Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** (this.failures - 1)));
      return false;
    }
  }

  private async post(since: number, epoch: string, rows: readonly Row[]): Promise<SyncResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetch(`/api/lists/${encodeURIComponent(this.store.listId)}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since, epoch, rows }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      return (await response.json()) as SyncResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private setState(state: SyncState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  } catch {
    // Not JSON (for example a proxy error page): fall through to the status code.
  }
  return `Server responded with ${response.status}`;
}
