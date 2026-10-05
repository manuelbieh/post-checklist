import { describe, expect, test } from 'vitest';
import { pickLanguage } from './i18n';

describe('pickLanguage', () => {
  test.each([
    [['de-DE', 'en-US'], 'de'],
    [['de'], 'de'],
    [['en-GB'], 'en'],
    [['fr-FR', 'de-AT'], 'de'],
    [['fr-FR'], 'en'],
    [[], 'en'],
  ])('%j → %s', (languages, expected) => {
    expect(pickLanguage(languages)).toBe(expected);
  });
});
