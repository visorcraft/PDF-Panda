import { AxeBuilder } from '@axe-core/webdriverio';
import {
  clickMenuAction,
  fixturePdf,
  fixturePdf3p,
  openPdfViaPathModal,
  resetToWelcome,
  waitForPageCount,
  waitForShell,
} from '../support/helpers';

async function assertNoAxeViolations(
  context: string,
  disabledRules?: string[],
) {
  // WebdriverIO v9 + Tauri's embedded WebKit driver do not support
  // `window/new`, which axe-core uses by default for cross-origin/frame
  // isolation. Legacy mode analyzes the current window directly.
  //
  // PDF Panda is an app-like desktop PDF editor, not a document website, so
  // axe's document-structure best-practice rules (page heading and landmark
  // containment) do not map cleanly to the toolbar/sidebar/viewer layout.
  // Disable them globally; the spec still catches real WCAG failures.
  const baseDisabledRules = ['page-has-heading-one', 'region'];
  let builder = new AxeBuilder({ client: browser })
    .setLegacyMode(true)
    .disableRules([...baseDisabledRules, ...(disabledRules ?? [])]);
  const results = await builder.analyze();
  if (results.violations.length > 0) {
    console.error(
      `Axe violations in ${context}:`,
      JSON.stringify(results.violations, null, 2),
    );
  }
  expect(results.violations).toEqual([]);
}

describe('axe accessibility', () => {
  before(async () => {
    await waitForShell();
  });

  it('welcome screen has no detectable axe violations', async () => {
    await resetToWelcome();
    await assertNoAxeViolations('welcome');
  });

  it('viewer has no detectable axe violations', async () => {
    await resetToWelcome();
    await openPdfViaPathModal(fixturePdf3p);
    await waitForPageCount('/ 3');
    await assertNoAxeViolations('viewer');
  });

  it('PDF/UA panel has no detectable axe violations', async () => {
    await resetToWelcome();
    await openPdfViaPathModal(fixturePdf);
    await waitForPageCount('/ 1');
    await clickMenuAction('view', 'pdfua-panel');
    await browser.waitUntil(
      async () => (await $('.pdfua-panel').isDisplayed()),
      { timeout: 10_000, timeoutMsg: 'expected PDF/UA panel' },
    );
    await assertNoAxeViolations('pdfua-panel');
  });

  it('settings page has no detectable axe violations', async () => {
    await resetToWelcome();
    await clickMenuAction('help', 'settings');
    await browser.waitUntil(
      async () => (await $('body').getText()).includes('Appearance'),
      { timeout: 10_000, timeoutMsg: 'expected Settings page' },
    );
    await assertNoAxeViolations('settings');
  });
});
