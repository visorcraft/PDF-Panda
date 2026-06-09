import type { AppMenuContext, AppMenus } from './types';
import { flattenMenuActions } from './menuBuilders';
import { buildFileEditMenus } from './buildAppMenusFileEdit';
import { buildPagesMenu } from './buildAppMenusPages';
import { buildDocumentMenu } from './buildAppMenusDocument';
import { buildAnnotMenu, buildSecurityMenu } from './buildAppMenusAnnot';
import { buildHelpMenu, buildQuickAccessActions, buildViewMenu } from './buildAppMenusChrome';

export { KEYBOARD_SHORTCUTS } from './buildMenuShortcuts';

export function buildAppMenus(ctx: AppMenuContext): AppMenus {
  const { fileMenu, editMenu } = buildFileEditMenus(ctx);
  const pagesMenu = buildPagesMenu(ctx);
  const documentMenu = buildDocumentMenu(ctx);
  const annotateMenu = buildAnnotMenu(ctx);
  const securityMenu = buildSecurityMenu(ctx);
  const viewMenu = buildViewMenu(ctx);
  const helpMenu = buildHelpMenu(ctx);

  const menus = [fileMenu, editMenu, pagesMenu, documentMenu, annotateMenu, securityMenu, viewMenu, helpMenu];
  const quickAccess = buildQuickAccessActions(ctx);
  const allActions = flattenMenuActions(menus);

  return { menus, quickAccess, allActions };
}
