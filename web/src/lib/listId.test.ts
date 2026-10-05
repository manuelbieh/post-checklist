import { describe, expect, test } from 'vitest';
import { generateListId, isValidListId, normalizeListId } from './listId';
import { ADJECTIVES, ANIMALS, NOUNS } from './words';

describe('generateListId', () => {
  test('combines an adjective, an animal and a noun', () => {
    const [adjective, animal, noun, ...rest] = generateListId().split('-');

    expect(rest).toEqual([]);
    expect(ADJECTIVES).toContain(adjective);
    expect(ANIMALS).toContain(animal);
    expect(NOUNS).toContain(noun);
  });

  test('produces IDs that pass validation', () => {
    for (let i = 0; i < 50; i++) expect(isValidListId(generateListId())).toBe(true);
  });
});

describe('word lists', () => {
  const all = [...ADJECTIVES, ...ANIMALS, ...NOUNS];

  test('contain only short lowercase words', () => {
    expect(all.filter((word) => !/^[a-z]{3,9}$/.test(word))).toEqual([]);
  });

  test('never repeat a word, not even across lists', () => {
    expect(all.filter((word, index) => all.indexOf(word) !== index)).toEqual([]);
  });

  test('allow at least 2^23 different IDs', () => {
    expect(ADJECTIVES.length * ANIMALS.length * NOUNS.length).toBeGreaterThanOrEqual(2 ** 23);
  });
});

describe('normalizeListId', () => {
  test.each([
    ['brave-otter-harbor', 'brave-otter-harbor'],
    ['  Brave Otter Harbor ', 'brave-otter-harbor'],
    ['brave_otter__harbor', 'brave-otter-harbor'],
    ['brave—otter–harbor', 'brave-otter-harbor'],
    ['brave-otter-harbor.', 'brave-otter-harbor'],
    ['https://post.example.com/#brave-otter-harbor', 'brave-otter-harbor'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeListId(input)).toBe(expected);
  });
});

describe('isValidListId', () => {
  test.each(['brave-otter-harbor', 'abc', 'a1-b2-c3'])('accepts %s', (id) => {
    expect(isValidListId(id)).toBe(true);
  });

  test.each(['', 'ab', 'Brave-Otter', 'brave_otter', '-brave', 'brave-', 'brave--otter', 'a'.repeat(65)])(
    'rejects %s',
    (id) => {
      expect(isValidListId(id)).toBe(false);
    },
  );
});
