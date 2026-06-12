/**
 * E2E-only render-time throw trigger.
 *
 * When the attribute `data-e2e-throw` is present on `<html>` and the build is
 * the E2E build (`VITE_WDIO=1`), this component throws during render so the
 * error-boundary E2E spec can verify the fallback UI. The attribute is set and
 * cleared by the E2E test; in production or dev builds this component renders
 * nothing and never throws.
 */
export function E2EThrowTrigger() {
  if (
    import.meta.env.VITE_WDIO === '1' &&
    typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-e2e-throw')
  ) {
    throw new Error('E2E forced render error');
  }
  return null;
}
