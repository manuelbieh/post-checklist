import { describe, expect, test } from 'vitest';
import { currentListId, forgetList, openList, recentListIds } from './session';
import { MemoryStorage } from './storage';

const WORD_ID = /^[a-z]+-[a-z]+-[a-z]+$/;

describe('list session', () => {
  test('creates a list ID on first launch and keeps it', () => {
    const storage = new MemoryStorage();

    const id = currentListId(storage);

    expect(id).toMatch(WORD_ID);
    expect(currentListId(storage)).toBe(id);
  });

  test('on first launch, uses the list from the link it was opened with', () => {
    // A home screen app on iOS starts with empty storage and the URL it was added from.
    const storage = new MemoryStorage();

    expect(currentListId(storage, 'brave-otter-harbor')).toBe('brave-otter-harbor');
    expect(currentListId(storage)).toBe('brave-otter-harbor');
    expect(recentListIds(storage)).toEqual(['brave-otter-harbor']);
  });

  test('keeps its own list when opened with a link to another one', () => {
    const storage = new MemoryStorage();
    openList(storage, 'brave-otter-harbor');

    expect(currentListId(storage, 'quiet-heron-lantern')).toBe('brave-otter-harbor');
  });

  test('ignores a link that is not a list ID', () => {
    const storage = new MemoryStorage();

    expect(currentListId(storage, 'Not Valid!')).toMatch(WORD_ID);
  });

  test('opening another list makes it current and remembers the previous one', () => {
    const storage = new MemoryStorage();
    const first = currentListId(storage);

    openList(storage, 'brave-otter-harbor');

    expect(currentListId(storage)).toBe('brave-otter-harbor');
    expect(recentListIds(storage)).toEqual(['brave-otter-harbor', first]);
  });

  test('remembers at most five lists, most recent first, without duplicates', () => {
    const storage = new MemoryStorage();

    for (const id of ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'bbb']) openList(storage, id);

    expect(recentListIds(storage)).toEqual(['bbb', 'fff', 'eee', 'ddd', 'ccc']);
  });

  test('replaces a stored list ID that is not valid', () => {
    const storage = new MemoryStorage();
    storage.setItem('postcheck:list', 'Not Valid!');

    expect(currentListId(storage)).toMatch(WORD_ID);
  });

  test('forgetting a list removes it from the recent lists and deletes its data on this device', () => {
    const storage = new MemoryStorage();
    openList(storage, 'unused-list');
    storage.setItem('postcheck:data:unused-list', '{}');
    openList(storage, 'brave-otter-harbor');

    forgetList(storage, 'unused-list');

    expect(recentListIds(storage)).toEqual(['brave-otter-harbor']);
    expect(storage.getItem('postcheck:data:unused-list')).toBeNull();
  });
});
