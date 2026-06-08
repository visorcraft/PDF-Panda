import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePdf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sample.pdf');

async function openFileMenu() {
  await $('[data-testid="menu-file"]').click();
}

async function chooseOpenPdfFromMenu() {
  await openFileMenu();
  await $('[data-testid="open-pdf"]').click();
}

describe('PDF Panda shell', () => {
  it('shows Open PDF under the File menu on launch', async () => {
    await openFileMenu();
    const openItem = await $('[data-testid="open-pdf"]');
    await expect(openItem).toBeDisplayed();
    await expect(openItem).toHaveText(expect.stringContaining('Open PDF'));
  });

  it('opens a PDF via the path modal and shows page controls', async () => {
    await chooseOpenPdfFromMenu();
    await $('[data-testid="open-pdf-path"]').setValue(fixturePdf);
    await $('[data-testid="open-pdf-submit"]').click();

    const pageCount = await $('[data-testid="page-count"]');
    await browser.waitUntil(
      async () => (await pageCount.getText()) === '/ 1',
      { timeout: 45_000, timeoutMsg: 'expected page count after opening fixture PDF' },
    );
  });

  it('marks the document dirty after rotate', async () => {
    const saveBtn = await $('[data-testid="save-pdf"]');
    await expect(saveBtn).toHaveText('Save');
    await $('[data-testid="rotate-page"]').click();
    await browser.waitUntil(
      async () => (await saveBtn.getText()) === 'Save •',
      { timeout: 15_000, timeoutMsg: 'expected dirty save label after rotate' },
    );
  });
});
