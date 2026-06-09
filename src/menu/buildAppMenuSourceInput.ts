import { buildAppMenusFromSource } from './buildAppMenusFromSource';
import type { BuildAppMenuSourceInput } from './buildAppMenuSource';

export type BuildAppMenuSourceInputArgs = BuildAppMenuSourceInput;

export function buildAppMenuSourceInput(input: BuildAppMenuSourceInputArgs) {
  return buildAppMenusFromSource(input);
}
