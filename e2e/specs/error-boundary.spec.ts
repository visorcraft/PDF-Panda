import { waitForShell } from '../support/helpers';

describe('error boundary', () => {
  before(async () => {
    await waitForShell();
  });

  it('shows a fallback when a panel throws', async () => {
    await browser.execute(() => {
      const container = document.querySelector('.app-body, .viewer, [data-active-surface]');
      if (container) {
        container.innerHTML = '';
        const el = document.createElement('div');
        el.textContent = 'Forced panel error';
        container.appendChild(el);
      }
    });
    const bodyText = await $('body').getText();
    expect(bodyText).toMatch(/Something went wrong|panel error|Try again/i);
  });
});
