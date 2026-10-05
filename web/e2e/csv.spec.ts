import { addVenues, captureSharedFiles, draftInput, expect, exportFile, mark, openMenu, test, toast, venueInput } from './fixtures';

// iPhone and iPad save files through the share sheet ("Save to Files"), everything else downloads.
let viaShareSheet = false;

test.beforeEach(async ({ page, browserName, isMobile }) => {
  viaShareSheet = browserName === 'webkit' && isMobile;
  if (viaShareSheet) await captureSharedFiles(page);
  await page.goto('/');
});

test('export syncs first, then downloads the CSV', async ({ page }) => {
  await addVenues(page, 'Pizza Place', 'Bar "Zur Ecke", Mitte');
  await mark(page, 'Instagram', 'Pizza Place').click();

  const file = await exportFile(page, viaShareSheet);

  expect(file.name).toMatch(/^post-check-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(file.text).toBe(
    '﻿No,Venue,Instagram,TikTok\r\n1,Pizza Place,y,n\r\n2,"Bar ""Zur Ecke"", Mitte",n,n\r\n',
  );
  await expect(toast(page)).toHaveText('Exported 2 venues');
});

test.describe(() => {
  // Playwright can't intercept requests that pass through a service worker (WebKit).
  test.use({ serviceWorkers: 'block' });

  test('export still saves the CSV when the sync fails', async ({ page }) => {
    await addVenues(page, 'Pizza Place');
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));

    const file = await exportFile(page, viaShareSheet);

    expect(file.text).toContain('1,Pizza Place,n,n');
    await expect(toast(page)).toContainText("Exported 1 venue from this device. The sync didn't finish");
  });
});

test('imports a German Excel CSV into an empty list', async ({ page }) => {
  await openMenu(page);
  await page.getByLabel('Import CSV').setInputFiles({
    name: 'liste.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Nr;Restaurant;Insta;TikTok\r\n1;Café Müller;x;\r\n2;Bar Centrale;;ja\r\n', 'latin1'),
  });

  await expect(toast(page)).toHaveText('Imported 2 venues');
  await expect(venueInput(page, 1)).toHaveValue('Café Müller');
  await expect(mark(page, 'Instagram', 'Café Müller')).toBeChecked();
  await expect(mark(page, 'TikTok', 'Bar Centrale')).toBeChecked();
  await expect(mark(page, 'Instagram', 'Bar Centrale')).not.toBeChecked();
});

test('importing into a list with rows asks whether to add or replace', async ({ page }) => {
  await addVenues(page, 'Pizza Place');

  await openMenu(page);
  await page.getByLabel('Import CSV').setInputFiles({
    name: 'backup.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('No,Venue,Instagram,TikTok\n1,Wine Bar,y,n\n'),
  });

  const dialog = page.getByRole('dialog', { name: 'Import CSV' });
  await expect(dialog).toContainText('1 venue in backup.csv');
  await dialog.getByRole('button', { name: 'Replace list' }).click();

  await expect(toast(page)).toHaveText('Imported 1 venue');
  await expect(venueInput(page, 1)).toHaveValue('Wine Bar');
  // The empty line for the next venue follows right after: Pizza Place is gone.
  await expect(draftInput(page)).toHaveAccessibleName('Venue, Row 2');
});
