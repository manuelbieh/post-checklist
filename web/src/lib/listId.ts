import { randomIndex } from './ids';
import { ADJECTIVES, ANIMALS, NOUNS } from './words';

const LIST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A new random list ID such as "brave-otter-harbor". */
export function generateListId(): string {
  return [ADJECTIVES, ANIMALS, NOUNS].map((words) => words[randomIndex(words.length)]).join('-');
}

/**
 * Turns typed or pasted input into the canonical ID form. Accepts share links
 * (the ID follows the #) and whatever phone keyboards make of hyphens.
 */
export function normalizeListId(input: string): string {
  const hash = input.lastIndexOf('#');
  const id = hash >= 0 ? input.slice(hash + 1) : input;
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Same rule as the server: lowercase words joined by single hyphens, 3–64 characters. */
export function isValidListId(id: string): boolean {
  return id.length >= 3 && id.length <= 64 && LIST_ID.test(id);
}
