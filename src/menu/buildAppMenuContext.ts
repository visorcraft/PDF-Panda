import type { AppMenuContext, AppMenuContextSource } from './types';
import { menuContextDocAnnotFields } from './buildAppMenuContextDocAnnotFields';
import { menuContextPagesFields } from './buildAppMenuContextPagesFields';

export function buildAppMenuContext(source: AppMenuContextSource): AppMenuContext {
  return {
    ...menuContextDocAnnotFields(source),
    ...menuContextPagesFields(source),
    activeSurface: source.activeSurface,
    openSettings: source.openSettings,
    shortcutBindings: source.shortcutBindings,
  };
}
