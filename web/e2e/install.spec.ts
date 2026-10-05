import { expect, readListId, test } from './fixtures';

test('an installed app starts on the list it was installed from', async ({ page, request }) => {
  await page.goto('/');
  const listId = await readListId(page);

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href ?? '')).json();

  expect(manifest.start_url).toBe(`/#${listId}`);
  expect(manifest.id).toBe('/');
});

test('Chrome can install the app', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Uses the Chrome DevTools Protocol');
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');

  // Playwright's browser contexts count as incognito windows, where Chrome never installs apps.
  expect(installabilityErrors.map((error) => error.errorId).filter((id) => id !== 'in-incognito')).toEqual([]);
});
