import {
  cancelUnsavedIfPrompted,
  captureTabWorkingPaths,
  clickMenuAction,
  clickQuickAction,
  closeTab,
  discardUnsavedIfPrompted,
  findText,
  fixturePdf,
  fixturePdfB,
  getSaveLabel,
  getZoomInput,
  openPdfViaPathModal,
  pathExists,
  resetToWelcome,
  selectTab,
  setZoomPercent,
  waitForPageCount,
  waitForPdfOpen,
  waitForSearchResults,
  waitForShell,
  waitForWelcome,
} from '../support/helpers';

describe('multi-document tabs', () => {
  before(async () => {
    await waitForShell();
    await resetToWelcome();
  });

  beforeEach(async () => {
    await resetToWelcome();
  });

  it('opens two documents with independent zoom', async () => {
    await openPdfViaPathModal(fixturePdf);
    await waitForPageCount('/ 1');
    await setZoomPercent('150');
    await openPdfViaPathModal(fixturePdfB);
    await waitForPageCount('/ 1');
    await browser.waitUntil(
      async () => (await $$('[data-testid^="doc-tab-"]')).length === 2,
      { timeout: 15_000, timeoutMsg: 'expected two document tabs' },
    );
    expect(await getZoomInput()).toBe('100');
    await selectTab('sample');
    expect(await getZoomInput()).toBe('150');
    await selectTab('sample-b');
    expect(await getZoomInput()).toBe('100');
  }, 240_000);

  it('keeps edits scoped to the active tab', async () => {
    await openPdfViaPathModal(fixturePdf);
    await openPdfViaPathModal(fixturePdfB);
    await selectTab('sample-b');
    await $('[data-testid="rotate-page"]').click();
    await browser.waitUntil(async () => (await getSaveLabel()) === 'Save •', {
      timeout: 15_000,
      timeoutMsg: 'expected dirty tab B',
    });
    await selectTab('sample');
    expect(await getSaveLabel()).toBe('Save');
    await selectTab('sample-b');
    expect(await getSaveLabel()).toBe('Save •');
  }, 240_000);

  it('isolates undo history per tab', async () => {
    await openPdfViaPathModal(fixturePdf);
    await openPdfViaPathModal(fixturePdfB);
    await selectTab('sample');
    await $('[data-testid="rotate-page"]').click();
    await selectTab('sample-b');
    await $('[data-testid="rotate-page"]').click();
    await selectTab('sample');
    await browser.waitUntil(async () => (await $('[data-testid="undo-btn"]').isEnabled()), {
      timeout: 10_000,
      timeoutMsg: 'expected undo enabled in tab A',
    });
    await clickQuickAction('undo-btn');
    await browser.waitUntil(async () => (await getSaveLabel()) === 'Save', {
      timeout: 15_000,
      timeoutMsg: 'expected tab A clean after undo',
    });
    await selectTab('sample-b');
    expect(await getSaveLabel()).toBe('Save •');
  }, 240_000);

  it('restores per-tab find state', async () => {
    await openPdfViaPathModal(fixturePdf);
    await openPdfViaPathModal(fixturePdfB);
    await selectTab('sample');
    await findText('Hello');
    await waitForSearchResults(1);
    await browser.keys('Escape');
    await selectTab('sample-b');
    await findText('ZZZNOTFOUND');
    await browser.waitUntil(
      async () => !(await $('[data-testid="search-results"]').isDisplayed().catch(() => false)),
      { timeout: 15_000, timeoutMsg: 'expected no matches in tab B' },
    );
    await browser.keys('Escape');
    await selectTab('sample');
    await findText('Hello');
    await waitForSearchResults(1);
  }, 240_000);

  it('prompts before closing a dirty tab', async () => {
    await openPdfViaPathModal(fixturePdf);
    await openPdfViaPathModal(fixturePdfB);
    await selectTab('sample-b');
    await $('[data-testid="rotate-page"]').click();
    await closeTab('sample-b');
    await (await $('[data-testid="unsaved-cancel"]')).waitForDisplayed({ timeout: 10_000 });
    await cancelUnsavedIfPrompted();
    expect((await $$('[data-testid^="doc-tab-"]')).length).toBe(2);
    await closeTab('sample-b');
    await discardUnsavedIfPrompted();
    await browser.waitUntil(
      async () => (await $$('[data-testid^="doc-tab-"]')).length === 0,
      { timeout: 10_000, timeoutMsg: 'expected tab bar hidden after one tab remains' },
    );
  }, 240_000);

  it('focuses an already-open document instead of duplicating tabs', async () => {
    await openPdfViaPathModal(fixturePdf);
    await waitForPdfOpen();
    await openPdfViaPathModal(fixturePdf);
    await waitForPageCount('/ 1');
    const tabs = await $$('[data-testid^="doc-tab-"]');
    expect(tabs.length).toBe(0);
  }, 180_000);

  it('cleans up working copies after all tabs close', async () => {
    await openPdfViaPathModal(fixturePdf);
    await openPdfViaPathModal(fixturePdfB);
    const paths = await captureTabWorkingPaths();
    expect(paths.length).toBe(2);
    await closeTab('sample-b');
    await discardUnsavedIfPrompted();
    const tabsLeft = await $$('[data-testid^="doc-tab-"]');
    if (tabsLeft.length > 0) {
      await closeTab('sample');
    } else {
      await clickMenuAction('file', 'close');
    }
    await discardUnsavedIfPrompted();
    await waitForWelcome();
    for (const p of paths) {
      expect(await pathExists(p)).toBe(false);
    }
  }, 240_000);
});
