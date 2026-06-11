import { waitForShell, clickMenuAction } from '../support/helpers';

describe('update notification', () => {
  beforeEach(async () => {
    await browser.execute(() => window.location.reload());
    await waitForShell();
  });

  it('opens update modal and shows up-to-date status on Linux', async () => {
    await clickMenuAction('help', 'check-updates');

    const modal = await $('[data-testid="update-modal"]');
    await modal.waitForDisplayed({ timeout: 15_000 });

    const text = await modal.getText();
    expect(text).toContain('Check for Updates');
    expect(text).toContain('PDF Panda is up to date');

    // Close via backdrop click
    const backdrop = await $('.modal-backdrop');
    await backdrop.click();
    await modal.waitForDisplayed({ reverse: true, timeout: 5_000 });
  });
});
