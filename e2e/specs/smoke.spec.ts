import {
  clickMenuAction,
  fixturePdf,
  fixturePdf3p,
  fixturePdfB,
  openFileMenu,
  openPdfViaPathModal,
  selectTextLayerSpan,
  waitForPageCount,
  waitForShell,
} from '../support/helpers';

describe('PDF Panda shell', () => {
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
    const saveBtn = await $('[data-testid="save-pdf"]');
    await expect(saveBtn).toHaveText('Save');
    await $('[data-testid="rotate-page"]').click();
    await browser.waitUntil(
      async () => (await saveBtn.getText()) === 'Save •',
      { timeout: 15_000, timeoutMsg: 'expected dirty save label after rotate' },
    );
  });
});

describe('v0.5 viewer features', () => {
  it('highlights text selected in the text layer', async () => {
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
    await openPdfViaPathModal(fixturePdf3p);
    await waitForPageCount('/ 3');
    await clickMenuAction('view', 'continuous-scroll');
    await browser.waitUntil(
      async () => (await $$('[data-testid^="continuous-page-"]')).length >= 2,
      { timeout: 30_000, timeoutMsg: 'expected at least two continuous page slots' },
    );
  });

  it('opens two documents in separate tabs', async () => {
    await openPdfViaPathModal(fixturePdfB);
    await waitForPageCount('/ 1');
    await browser.waitUntil(
      async () => (await $$('[data-testid^="doc-tab-"]')).length === 2,
      { timeout: 15_000, timeoutMsg: 'expected two document tabs' },
    );
  });
});
