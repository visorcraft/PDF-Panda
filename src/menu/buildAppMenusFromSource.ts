import { buildAppMenuContext } from './buildAppMenuContext';
import { buildAppMenuSource, type BuildAppMenuSourceInput } from './buildAppMenuSource';
import { buildAppMenus } from './buildAppMenus';

export function buildAppMenusFromSource(input: BuildAppMenuSourceInput) {
  return buildAppMenus(buildAppMenuContext(buildAppMenuSource(input)));
}
