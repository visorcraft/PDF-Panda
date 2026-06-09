import { buildAppModalsSource } from './buildAppModalsSource';
import type { AppModalsRuntime } from './appModalsContext';

export type BuildAppModalCtxSourceInput = AppModalsRuntime;

export function buildAppModalCtxSource(input: BuildAppModalCtxSourceInput) {
  return buildAppModalsSource(input);
}
