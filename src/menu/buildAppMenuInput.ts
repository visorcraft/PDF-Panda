import type { BuildAppMenuSourceInput } from '../menu/buildAppMenuSource';
import { buildAppMenusFromSource } from './buildAppMenusFromSource';
import type { BuildAppMenuInputArgs } from './buildAppMenuInputArgs';
import { menuInputDocFields } from './buildAppMenuInputDocFields';
import { menuInputPagesFields } from './buildAppMenuInputPagesFields';

export function buildAppMenuInput(args: BuildAppMenuInputArgs) {
  return buildAppMenusFromSource({
    ...menuInputDocFields(args),
    ...menuInputPagesFields(args),
    surface: args.surface,
    shortcutBindings: args.shortcutBindings,
  } satisfies BuildAppMenuSourceInput);
}
