import {
  applyRedactions,
  clickMenuAction,
  drawRedactionOverText,
  drawRedactionOverTextByClicks,
  findText,
  fixturePdf,
  fixturePdf3p,
  openPdfViaPathModal,
  resetToWelcome,
  selectTextLayerSpan,
  waitForNoSearchResults,
  waitForPageCount,
  waitForPdfOpen,
  waitForSearchResults,
  waitForShell,
} from '../support/helpers';

describe('v0.5 viewer features', () => {
  before(async () => {
    await waitForShell();
    await resetToWelcome();
  });

  it('highlights text selected in the text layer', async () => {
    await openPdfViaPathModal(fixturePdf);
    await waitForPageCount('/ 1');
    await browser.waitUntil(async () => (await $('[data-testid="text-layer"]').isDisplayed()), {
      timeout: 45_000,
      timeoutMsg: 'expected text layer',
    });
    await selectTextLayerSpan('Hello');
    await clickMenuAction('annotate', 'highlight-selection');
    await clickMenuAction('view', 'annotations-panel');
    await browser.waitUntil(
      async () => (await $$('[data-testid="annotation-row"]')).length >= 1,
      { timeout: 20_000, timeoutMsg: 'expected highlight annotation in panel' },
    );
  });

  it('shows multiple page slots in continuous scroll mode', async () => {
    await resetToWelcome();
    await openPdfViaPathModal(fixturePdf3p);
    await waitForPageCount('/ 3');
    await clickMenuAction('view', 'continuous-scroll');
    await browser.waitUntil(
      async () => (await $$('[data-testid^="continuous-page-"]')).length >= 2,
      { timeout: 30_000, timeoutMsg: 'expected at least two continuous page slots' },
    );
  });

  it('apply redactions removes searchable text', async () => {
    await resetToWelcome();
    await openPdfViaPathModal(fixturePdf);
    await waitForPdfOpen();
    await findText('Hello');
    await waitForSearchResults(1);
    await browser.keys('Escape');
    await drawRedactionOverText();
    await applyRedactions();
    await findText('Hello');
    await waitForNoSearchResults();
  });

  it('apply redactions via click-click fallback removes searchable text', async () => {
    await resetToWelcome();
    await openPdfViaPathModal(fixturePdf);
    await waitForPdfOpen();
    await findText('Hello');
    await waitForSearchResults(1);
    await browser.keys('Escape');
    await drawRedactionOverTextByClicks();
    await applyRedactions();
    await findText('Hello');
    await waitForNoSearchResults();
  });

  it('check for updates menu item exists in Help menu', async () => {
    await resetToWelcome();
    const trigger = await $('[data-testid="menu-help"]');
    await trigger.click();
    const action = await $('[data-testid="check-updates"]');
    if (!(await action.isDisplayed())) {
      throw new Error('Expected Check for Updates menu item to be visible');
    }
    // Close menu without clicking (avoids network request in E2E)
    await browser.keys('Escape');
  });
});
