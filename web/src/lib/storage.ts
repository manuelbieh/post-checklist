/** The subset of the Storage API the app needs (localStorage in the browser). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Keeps data in memory only: for tests, and for browsers that block localStorage. */
export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** localStorage when the browser allows it; otherwise an in-memory fallback. */
export function openStorage(): { storage: KeyValueStorage; persistent: boolean } {
  try {
    const probe = 'postcheck:probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { storage: localStorage, persistent: true };
  } catch {
    return { storage: new MemoryStorage(), persistent: false };
  }
}
