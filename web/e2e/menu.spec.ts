import { addVenues, expect, expectSynced, openMenu, readListId, test, venueInput } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the menu opens with focus on the sheet, not on a button', async ({ page }) => {
  await openMenu(page);

  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeFocused();
});

test('"Open that list" puts the cursor into the list ID field', async ({ page }) => {
  await page.getByRole('button', { name: 'Open that list' }).click();

  await expect(page.getByLabel('Open a list by ID')).toBeFocused();
});

test('opening a list by ID explains typos and unknown IDs', async ({ page }) => {
  await openMenu(page);
  const field = page.getByLabel('Open a list by ID');
  const open = page.getByRole('button', { name: 'Open', exact: true });

  await field.fill('!!!');
  await open.click();
  await expect(page.getByRole('alert')).toHaveText('List IDs are words joined by hyphens, like brave-otter-harbor.');

  await field.fill('Purple Walrus Teapot');
  await open.click();
  await expect(page.getByRole('alert')).toHaveText('No list with this ID. Check the spelling.');
});

test('typing the ID of a list from another device opens it', async ({ browser, page }, testInfo) => {
  const other = await browser.newContext(testInfo.project.use);
  const otherPage = await other.newPage();
  await otherPage.goto('/');
  await addVenues(otherPage, 'Pizza Place');
  await expectSynced(otherPage);
  const listId = await readListId(otherPage);
  await other.close();

  await openMenu(page);
  // People copy IDs with spaces or capitals; the app normalizes them.
  await page.getByLabel('Open a list by ID').fill(` ${listId.replaceAll('-', ' ').toUpperCase()} `);
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
  await expect(page.getByRole('dialog')).toBeHidden();
});
