import { describe, expect, it } from 'vitest';
import { renderServiceWorker } from './serviceWorker';

const TEMPLATE = 'const VERSION = __VERSION__;\nconst PRECACHE = __PRECACHE__;\n';

function precacheOf(source: string): string[] {
  return JSON.parse(/const PRECACHE = (.*);/.exec(source)![1]!);
}

function versionOf(source: string): string {
  return JSON.parse(/const VERSION = (.*);/.exec(source)![1]!);
}

describe('renderServiceWorker', () => {
  it('precaches every file by its URL and the page as /', () => {
    const files = new Map<string, string | Uint8Array>([
      ['index.html', '<html>'],
      ['assets/index-abc.js', 'code'],
      ['favicon.svg', new Uint8Array([1, 2, 3])],
    ]);

    expect(precacheOf(renderServiceWorker(TEMPLATE, files))).toEqual(['/', '/assets/index-abc.js', '/favicon.svg']);
  });

  it('leaves out the worker itself, dotfiles, source maps and excluded files', () => {
    const files = new Map<string, string>([
      ['index.html', '<html>'],
      ['sw.js', 'worker'],
      ['.gitkeep', ''],
      ['assets/index-abc.js.map', '{}'],
      ['icon-512.png', 'png'],
    ]);

    expect(precacheOf(renderServiceWorker(TEMPLATE, files, /^icon-/))).toEqual(['/']);
  });

  it('changes the version when a precached file changes, and only then', () => {
    const version = (js: string, icon = 'png') =>
      versionOf(
        renderServiceWorker(
          TEMPLATE,
          new Map([
            ['index.html', '<html>'],
            ['assets/index.js', js],
            ['icon-512.png', icon],
          ]),
          /^icon-/,
        ),
      );

    expect(version('one')).toBe(version('one'));
    expect(version('one')).not.toBe(version('two'));
    expect(version('one', 'png')).toBe(version('one', 'new png'));
  });
});
