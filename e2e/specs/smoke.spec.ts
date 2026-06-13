import {
  clickMenuAction,
  fixturePdf,
  openFileMenu,
  openPdfViaPathModal,
  resetToWelcome,
  waitForPageCount,
  waitForShell,
} from '../support/helpers';

describe('PDF Panda shell', () => {
  before(async () => {
    await waitForShell();
  });

  beforeEach(async () => {
    await resetToWelcome();
  });

  it('shows Open PDF under the File menu on launch', async () => {
    await openFileMenu();
    const openItem = await $('[data-testid="open-pdf"]');
    await expect(openItem).toBeDisplayed();
    await expect(openItem).toHaveText(expect.stringContaining('Open PDF'));
  });

  it('opens a PDF via the path modal and shows page controls', async () => {
    await openPdfViaPathModal(fixturePdf);
    await waitForPageCount('/ 1');
  });

  it('marks the document dirty after rotate', async () => {
    await openPdfViaPathModal(fixturePdf);
    await waitForPageCount('/ 1');

    const saveBtn = await $('[data-testid="save-pdf"]');
    await expect(saveBtn).toHaveText('Save');

    await $('[data-testid="rotate-page"]').click();
    const applyBtn = await $('[data-testid="rotate-modal-apply"]');
    await applyBtn.waitForDisplayed({ timeout: 10_000 });
    await applyBtn.click();

    await browser.waitUntil(
      async () => (await saveBtn.getText()) === 'Save •',
      { timeout: 15_000, timeoutMsg: 'expected dirty save label after rotate' },
    );
  });

  it('toggles dark theme via View menu', async () => {
    await clickMenuAction('view', 'theme-dark');
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.getAttribute('data-theme'))) === 'dark',
      { timeout: 5_000, timeoutMsg: 'expected dark theme' },
    );
    // Toggle back to light for subsequent tests
    await clickMenuAction('view', 'theme-light');
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.getAttribute('data-theme'))) === 'light',
      { timeout: 5_000, timeoutMsg: 'expected light theme' },
    );
  });
});
