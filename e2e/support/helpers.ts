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

export async function openPdfViaPathModal(pdfPath: string) {
  const welcome = await $('[data-testid="welcome-open-pdf"]');
  if (await welcome.isDisplayed().catch(() => false)) {
    await welcome.click();
  } else {
    await openFileMenu();
    await $('[data-testid="open-pdf"]').click();
  }
  const pathInput = await $('[data-testid="open-pdf-path"]');
  await pathInput.waitForDisplayed({ timeout: 15_000 });
  await pathInput.click();
  // WebKit setValue does not fire React onChange; set the native value + input event.
  await browser.execute((path: string) => {
    const input = document.querySelector('[data-testid="open-pdf-path"]') as HTMLInputElement | null;
    if (!input) throw new Error('path input missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, path);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, pdfPath);
  const submit = await $('[data-testid="open-pdf-submit"]');
  await browser.waitUntil(async () => (await submit.isEnabled()), {
    timeout: 5_000,
    timeoutMsg: 'open submit enabled',
  });
  await submit.click();
}

export async function waitForPageCount(expected: string) {
  const pageCount = await $('[data-testid="page-count"]');
  await browser.waitUntil(async () => (await pageCount.getText()) === expected, {
    timeout: 45_000,
    timeoutMsg: `expected page count ${expected}`,
  });
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
    { timeout: 45_000, timeoutMsg: `text layer span containing "${text}"` },
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
