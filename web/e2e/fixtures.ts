import { readFile } from 'node:fs/promises';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

// Requests that fail on purpose while a test has the network off.
const NETWORK_NOISE = /Failed to load resource|ERR_INTERNET_DISCONNECTED|appears to be offline|Load failed|NetworkError/i;
// A reload cancels a running sync request. The app handles that, but WebKit still reports it
// as an error ("Fetch API cannot load … due to access control checks").
const CANCELED_BY_RELOAD = /^Fetch API cannot load .* due to access control checks\.$/;

/** Collects console errors and uncaught exceptions (CSP violations show up here too). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !NETWORK_NOISE.test(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    // Playwright cuts the message at the URL's "//"; the stack keeps the full text.
    const text = error.stack?.split('\n')[0] ?? error.message;
    if (!CANCELED_BY_RELOAD.test(text)) errors.push(text);
  });
  return errors;
}

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors = trackErrors(page);
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const venueInput = (page: Page, row: number): Locator => page.getByRole('textbox', { name: `Venue, Row ${row}` });

export const draftInput = (page: Page): Locator => page.locator('.row-draft .venue-input');

export const mark = (page: Page, platform: 'Instagram' | 'TikTok', venue: string): Locator =>
  page.getByRole('checkbox', { name: `${platform}: ${venue}`, exact: true });

export const syncButton = (page: Page): Locator => page.locator('.sync-button');

export const toast = (page: Page): Locator => page.locator('.toast');

/** Types venues into the empty row, one after another, the way a person would. */
export async function addVenues(page: Page, ...names: string[]): Promise<void> {
  await draftInput(page).click();
  for (const name of names) {
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
  }
}

/** Holds the pointer on an element, like a long press. */
export async function hold(page: Page, target: Locator, ms: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Element to hold is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

export async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

export async function readListId(page: Page): Promise<string> {
  await openMenu(page);
  const id = (await page.locator('.list-id-value').textContent()) ?? '';
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  return id;
}

/**
 * On iPhone the app hands the CSV to the share sheet, which headless WebKit can't show.
 * This replaces navigator.share and records the files the app shares.
 */
export async function captureSharedFiles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: { name: string; text: string }[] = [];
    Object.assign(window, { sharedFiles: shared });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files = [] }: ShareData) => {
        for (const file of files) {
          // file.text() would drop the byte order mark the CSV starts with.
          const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer());
          shared.push({ name: file.name, text });
        }
      },
    });
  });
}

/** Clicks Export CSV and returns the file the app saved: downloaded, or shared on iPhone. */
export async function exportFile(page: Page, viaShareSheet: boolean): Promise<{ name: string; text: string }> {
  await openMenu(page);
  const exportButton = page.getByRole('button', { name: 'Export CSV' });
  if (viaShareSheet) {
    await exportButton.click();
    const file = await page.waitForFunction(() => (window as unknown as { sharedFiles: unknown[] }).sharedFiles[0]);
    return (await file.jsonValue()) as { name: string; text: string };
  }
  const download = page.waitForEvent('download');
  await exportButton.click();
  const file = await download;
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') };
}

export async function expectSynced(page: Page): Promise<void> {
  await expect(syncButton(page)).toHaveAccessibleName(/^All changes synced/, { timeout: 10_000 });
}
