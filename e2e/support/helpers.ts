import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export const fixturePdf = path.join(fixturesDir, 'sample.pdf');
export const fixturePdf3p = path.join(fixturesDir, 'sample-3p.pdf');
export const fixturePdfB = path.join(fixturesDir, 'sample-b.pdf');

export async function waitForShell() {
  await browser.waitUntil(async () => (await $('[data-testid="menu-file"]').isDisplayed()), {
    timeout: 30_000,
    timeoutMsg: 'expected application menu',
  });
}

export async function openFileMenu() {
  await waitForShell();
  const trigger = await $('[data-testid="menu-file"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();
    const openItem = await $('[data-testid="open-pdf"]');
    if (await openItem.isDisplayed().catch(() => false)) return;
    await browser.pause(150);
  }
  throw new Error('file menu did not open');
}

async function showOpenPdfModal() {
  const welcome = await $('[data-testid="welcome-open-pdf"]');
  if (await welcome.isDisplayed().catch(() => false)) {
    await welcome.click();
    return;
  }
  await openFileMenu();
  await $('[data-testid="open-pdf"]').click();
}

async function discardUnsavedIfPrompted() {
  const discard = await $('[data-testid="unsaved-discard"]');
  if (await discard.isDisplayed().catch(() => false)) {
    await discard.click();
    await browser.pause(200);
  }
}

export async function openPdfViaPathModal(pdfPath: string) {
  await showOpenPdfModal();
  await discardUnsavedIfPrompted();

  const pathInput = await $('[data-testid="open-pdf-path"]');
  await pathInput.waitForDisplayed({ timeout: 15_000 });
  await pathInput.click();
  await browser.execute((filePath: string) => {
    const input = document.querySelector('[data-testid="open-pdf-path"]') as HTMLInputElement | null;
    if (!input) throw new Error('path input missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, filePath);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: filePath, inputType: 'insertFromPaste' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, pdfPath);

  const submit = await $('[data-testid="open-pdf-submit"]');
  await browser.waitUntil(async () => (await submit.isEnabled()), {
    timeout: 10_000,
    timeoutMsg: 'open submit enabled',
  });
  await submit.click();
  await waitForPdfOpen();
}

export async function waitForPdfOpen() {
  await browser.waitUntil(
    async () => {
      const btn = await $('[data-testid="save-pdf"]');
      return btn.isDisplayed().catch(() => false);
    },
    { timeout: 60_000, timeoutMsg: 'expected PDF viewer toolbar' },
  );
}

export async function waitForPageCount(expected: string) {
  await browser.waitUntil(
    async () => {
      const els = await $$('[data-testid="page-count"]');
      if (els.length === 0) return false;
      const text = await els[0].getText();
      return text === expected;
    },
    { timeout: 60_000, timeoutMsg: `expected page count ${expected}` },
  );
}

export async function clickMenuAction(menuId: string, actionId: string) {
  const trigger = await $(`[data-testid="menu-${menuId}"]`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();
    const action = await $(`[data-testid="${actionId}"]`);
    if (await action.isDisplayed().catch(() => false)) {
      await action.click();
      return;
    }
    await browser.pause(150);
  }
  throw new Error(`menu action ${menuId}/${actionId} not found`);
}

export async function selectTextLayerSpan(text: string) {
  await browser.waitUntil(
    async () => {
      const spans = await $$('.text-layer span');
      for (const span of spans) {
        if ((await span.getText()).includes(text)) return true;
      }
      return false;
    },
    { timeout: 60_000, timeoutMsg: `text layer span containing "${text}"` },
  );
  await browser.execute((needle: string) => {
    const layer = document.querySelector('.text-layer');
    if (!layer) throw new Error('text layer missing');
    const span = Array.from(layer.querySelectorAll('span')).find((el) => el.textContent?.includes(needle));
    if (!span?.firstChild) throw new Error(`span with "${needle}" missing`);
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, Math.min(needle.length, span.textContent?.length ?? 0));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, text);
}
