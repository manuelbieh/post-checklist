import { addVenues, expect, expectSynced, mark, readListId, syncButton, test, trackErrors, venueInput } from './fixtures';

test('two devices converge after one of them edited offline', async ({ browser, page }, testInfo) => {
  const options = testInfo.project.use;

  // Device A starts a list.
  await page.goto('/');
  await addVenues(page, 'Pizza Place', 'Wine Bar');
  await expectSynced(page);
  const listId = await readListId(page);

  // Device B opens it through a share link.
  const contextB = await browser.newContext(options);
  const pageB = await contextB.newPage();
  const errorsB = trackErrors(pageB);
  await pageB.goto(`/#${listId}`);
  await expect(venueInput(pageB, 1)).toHaveValue('Pizza Place');
  await expect(venueInput(pageB, 2)).toHaveValue('Wine Bar');

  // A goes offline and marks Instagram; meanwhile B marks TikTok on the same row and renames the other.
  await page.context().setOffline(true);
  await mark(page, 'Instagram', 'Pizza Place').click();
  await expect(syncButton(page)).toHaveAccessibleName(/^Offline\. 1 change waiting/);

  await mark(pageB, 'TikTok', 'Pizza Place').click();
  await venueInput(pageB, 2).fill('Wine Bar Mitte');
  await venueInput(pageB, 2).press('Enter');
  await expectSynced(pageB);

  // Back online, A uploads its change and receives B's.
  await page.context().setOffline(false);
  await expect(mark(page, 'TikTok', 'Pizza Place')).toBeChecked();
  await expect(mark(page, 'Instagram', 'Pizza Place')).toBeChecked();
  await expect(venueInput(page, 2)).toHaveValue('Wine Bar Mitte');
  await expectSynced(page);

  // B picks up A's offline change on its next sync.
  await syncButton(pageB).click();
  await expect(mark(pageB, 'Instagram', 'Pizza Place')).toBeChecked();
  await expect(mark(pageB, 'TikTok', 'Pizza Place')).toBeChecked();

  expect(errorsB).toEqual([]);
  await contextB.close();
});

test('a share link asks first when this device already has a list', async ({ browser, page }, testInfo) => {
  const contextB = await browser.newContext(testInfo.project.use);
  const pageB = await contextB.newPage();
  await pageB.goto('/');
  await addVenues(pageB, 'Other Place');
  await expectSynced(pageB);
  const otherId = await readListId(pageB);
  await contextB.close();

  await page.goto('/');
  await addVenues(page, 'Pizza Place');
  await page.goto(`/#${otherId}`);

  const dialog = page.getByRole('dialog', { name: `Open the list ${otherId}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(venueInput(page, 1)).toHaveValue('Other Place');
});

test('the address carries the list, so bookmarks and home screen apps open it', async ({ browser, page }, testInfo) => {
  await page.goto('/');
  await addVenues(page, 'Pizza Place');
  await expectSynced(page);
  const listId = await readListId(page);
  await expect(page).toHaveURL(`/#${listId}`);

  // A home screen app on iOS starts with its own, empty storage and the address it was added from.
  const homeScreen = await browser.newContext(testInfo.project.use);
  const homeScreenPage = await homeScreen.newPage();
  await homeScreenPage.goto(page.url());
  await expect(venueInput(homeScreenPage, 1)).toHaveValue('Pizza Place');
  await expect(homeScreenPage).toHaveURL(`/#${listId}`);
  await homeScreen.close();
});

test('declining a share link keeps this list and its address', async ({ page }) => {
  await page.goto('/');
  await addVenues(page, 'Pizza Place');
  const listId = await readListId(page);

  await page.goto('/#purple-walrus-teapot');
  await page.getByRole('dialog').getByRole('button', { name: 'Stay on this list' }).click();

  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
  await expect(page).toHaveURL(`/#${listId}`);
});
