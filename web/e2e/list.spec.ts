import { addVenues, draftInput, expect, hold, mark, test, toast, venueInput } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('typing into the empty row creates rows without losing focus', async ({ page }) => {
  await expect(page.getByText('This list is empty.')).toBeVisible();

  await addVenues(page, 'Pizza Place', 'Wine Bar');

  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
  await expect(venueInput(page, 2)).toHaveValue('Wine Bar');
  await expect(draftInput(page)).toBeFocused();
  await expect(page.getByText('This list is empty.')).toBeHidden();
});

test('rows and marks survive a reload', async ({ page }) => {
  await addVenues(page, 'Pizza Place');
  await mark(page, 'TikTok', 'Pizza Place').click();

  await page.reload();

  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
  await expect(mark(page, 'TikTok', 'Pizza Place')).toBeChecked();
  await expect(mark(page, 'Instagram', 'Pizza Place')).not.toBeChecked();
});

test('a tap sets the X, a short tap keeps it, a long press removes it', async ({ page }) => {
  await addVenues(page, 'Pizza Place');
  const instagram = mark(page, 'Instagram', 'Pizza Place');

  await instagram.click();
  await expect(instagram).toBeChecked();

  await instagram.click();
  await expect(instagram).toBeChecked();
  await expect(toast(page)).toHaveText('Hold to remove the X');

  await hold(page, instagram, 250);
  await expect(instagram).toBeChecked();

  await hold(page, instagram, 800);
  await expect(instagram).not.toBeChecked();
});

test('on iPhone, only a tap that changes a mark toggles the haptic switch', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'webkit' || !isMobile, 'Safari on iPhone only');
  // Safari plays a haptic tick when a finger toggles a switch control.
  await addVenues(page, 'Pizza Place');
  const instagram = mark(page, 'Instagram', 'Pizza Place');
  const toggles = () => instagram.locator('input[switch]').evaluate((input: HTMLInputElement) => input.checked);

  await instagram.click();
  expect(await toggles()).toBe(true);

  await instagram.click();
  await expect(toast(page)).toHaveText('Hold to remove the X');
  expect(await toggles()).toBe(true);
});

test('the keyboard sets and removes marks', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hardware keyboard only');
  await addVenues(page, 'Pizza Place');
  const tiktok = mark(page, 'TikTok', 'Pizza Place');

  await tiktok.focus();
  await page.keyboard.press('Space');
  await expect(tiktok).toBeChecked();

  await page.keyboard.press('Delete');
  await expect(tiktok).not.toBeChecked();
});

test('a deleted row comes back with undo', async ({ page }) => {
  await addVenues(page, 'Pizza Place', 'Wine Bar');

  await page.getByRole('button', { name: 'Row 1, options' }).click();
  await page.getByRole('button', { name: 'Delete row' }).click();

  await expect(toast(page)).toContainText('Deleted “Pizza Place”');
  await expect(venueInput(page, 1)).toHaveValue('Wine Bar');

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
  await expect(venueInput(page, 2)).toHaveValue('Wine Bar');
});

test('clearing a name removes the empty row, with undo', async ({ page }) => {
  await addVenues(page, 'Pizza Place', 'Wine Bar');

  await venueInput(page, 1).fill('');
  await venueInput(page, 2).click();

  await expect(toast(page)).toContainText('Removed the empty row');
  await expect(venueInput(page, 1)).toHaveValue('Wine Bar');

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
});

test('opens without a network after the first visit', async ({ page, context, browserName }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await addVenues(page, 'Pizza Place');

  // Playwright's WebKit fails every request while offline, even those a service worker
  // answers. There the test checks that the page comes from the service worker.
  const offline = browserName !== 'webkit';
  if (offline) await context.setOffline(true);
  const response = await page.reload();

  expect(response?.fromServiceWorker()).toBe(true);
  await expect(venueInput(page, 1)).toHaveValue('Pizza Place');
  if (offline) await expect(page.locator('.sync-button')).toHaveAccessibleName(/^Offline/);
});
