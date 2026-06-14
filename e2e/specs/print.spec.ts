import {
  waitForShell,
  clickMenuAction,
  openPdfViaPathModal,
  fixturePdf,
} from '../support/helpers';

describe('print dialog', () => {
  beforeEach(async () => {
    await browser.execute(() => window.location.reload());
    await waitForShell();
  });

  it('opens the print dialog from the File menu', async () => {
    await openPdfViaPathModal(fixturePdf);
    await clickMenuAction('file', 'print');
    const dialog = await $('[data-testid="print-dialog"]');
    await dialog.waitForDisplayed({ timeout: 10_000 });
    expect(await dialog.getText()).toContain('Print');
  });
});
