import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const TEMPLATE_PATH = new URL('./sw.template.js', import.meta.url);

/**
 * Emits sw.js, a service worker that precaches the built app (bundle and
 * public files) so it starts without a network. The version is a hash of the
 * precached files: any change to them makes browsers install the new worker.
 */
export function serviceWorker({ exclude }: { exclude?: RegExp } = {}): Plugin {
  let publicDir = '';
  return {
    name: 'post-check-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle: {
      // After Vite has emitted index.html.
      order: 'post',
      handler(_options, bundle) {
        const files = new Map<string, string | Uint8Array>();
        for (const output of Object.values(bundle)) {
          files.set(output.fileName, output.type === 'chunk' ? output.code : output.source);
        }
        for (const path of publicDir ? listFiles(publicDir) : []) {
          files.set(relative(publicDir, path).split(sep).join('/'), readFileSync(path));
        }
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: renderServiceWorker(readFileSync(TEMPLATE_PATH, 'utf8'), files, exclude),
        });
      },
    },
  };
}

/** Fills the template's __VERSION__ and __PRECACHE__ placeholders. */
export function renderServiceWorker(
  template: string,
  files: ReadonlyMap<string, string | Uint8Array>,
  exclude?: RegExp,
): string {
  const hash = createHash('sha256');
  const urls: string[] = [];
  for (const name of [...files.keys()].sort()) {
    if (!isPrecached(name) || exclude?.test(name)) continue;
    hash.update(name).update('\0').update(files.get(name)!).update('\0');
    urls.push(name === 'index.html' ? '/' : `/${name}`);
  }
  const version = hash.digest('hex').slice(0, 12);
  return template
    .replace('__VERSION__', () => JSON.stringify(version))
    .replace('__PRECACHE__', () => JSON.stringify(urls.sort()));
}

function isPrecached(name: string): boolean {
  return name !== 'sw.js' && !name.endsWith('.map') && !name.split('/').some((part) => part.startsWith('.'));
}

function listFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
