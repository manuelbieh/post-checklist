export type Language = 'en' | 'de';

/** The first supported language in the user's preference order, English otherwise. */
export function pickLanguage(languages: readonly string[]): Language {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}
