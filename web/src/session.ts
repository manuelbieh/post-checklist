import { useSyncExternalStore } from 'react';
import { Clock } from './lib/hlc';
import { newNodeId } from './lib/ids';
import type { KeyValueStorage } from './lib/storage';
import { dataKey, ListStore, type ListSnapshot } from './lib/store';
import { SyncEngine, type SyncState } from './lib/sync';

/** One open list: its local store and the engine that syncs it. */
export interface ListSession {
  readonly store: ListStore;
  readonly engine: SyncEngine;
  /** Connects the list to the browser (sync triggers, other tabs, saving on hide). Returns a disconnect function. */
  start(): () => void;
}

export function createSession(listId: string, storage: KeyValueStorage): ListSession {
  const store = new ListStore(listId, storage, new Clock(newNodeId()));
  const engine = new SyncEngine(store);

  return {
    store,
    engine,
    start() {
      const stopSync = engine.start();
      const onStorage = (event: StorageEvent) => {
        if (event.key === dataKey(listId)) store.reloadFromStorage();
      };
      const onVisibility = () => {
        if (document.visibilityState !== 'hidden') return;
        store.flush();
        // The app may be suspended any moment now; try to get pending changes out first.
        if (store.getSnapshot().pending > 0) void engine.sync();
      };
      const flush = () => store.flush();
      window.addEventListener('storage', onStorage);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', flush);

      return () => {
        stopSync();
        window.removeEventListener('storage', onStorage);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', flush);
        store.flush();
      };
    },
  };
}

export function useListSnapshot(store: ListStore): ListSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useSyncState(engine: SyncEngine): SyncState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}
