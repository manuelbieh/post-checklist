import { generateListId, isValidListId } from './listId';
import type { KeyValueStorage } from './storage';
import { dataKey } from './store';

const CURRENT_KEY = 'postcheck:list';
const RECENT_KEY = 'postcheck:lists';
const MAX_RECENT = 5;

/**
 * The list this device works on. On first launch, that's the list from the link the app was
 * opened with (`linkedId`), or else a new list.
 */
export function currentListId(storage: KeyValueStorage, linkedId?: string): string {
  const stored = storage.getItem(CURRENT_KEY);
  if (stored !== null && isValidListId(stored)) return stored;
  const id = linkedId !== undefined && isValidListId(linkedId) ? linkedId : generateListId();
  openList(storage, id);
  return id;
}

/** Makes `id` the current list and remembers it for switching back. */
export function openList(storage: KeyValueStorage, id: string): void {
  storage.setItem(CURRENT_KEY, id);
  const recent = [id, ...recentListIds(storage).filter((other) => other !== id)].slice(0, MAX_RECENT);
  storage.setItem(RECENT_KEY, JSON.stringify(recent));
}

/** Lists used on this device, most recent first. */
export function recentListIds(storage: KeyValueStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && isValidListId(id));
  } catch {
    return [];
  }
}

/** Drops a list from this device: from the recent lists and from local storage. */
export function forgetList(storage: KeyValueStorage, id: string): void {
  storage.setItem(RECENT_KEY, JSON.stringify(recentListIds(storage).filter((other) => other !== id)));
  storage.removeItem(dataKey(id));
}
