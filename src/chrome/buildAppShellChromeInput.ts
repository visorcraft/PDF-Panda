import type { BuildAppChromeSourceInput } from './buildAppChromeSource';
import type { AppMenus } from '../menu/types';
import type { ShortcutBindings } from '../app/useShortcutBindingsState';

export type BuildAppShellChromeInputArgs = {
  menus: AppMenus;
  help: {
    showCommandPalette: boolean;
    showShortcutsHelp: boolean;
    showLicenses: boolean;
    showCredits: boolean;
    showAbout: boolean;
    setShowCommandPalette: (open: boolean) => void;
    setShowShortcutsHelp: (open: boolean) => void;
    setShowLicenses: (open: boolean) => void;
    setShowCredits: (open: boolean) => void;
    setShowAbout: (open: boolean) => void;
  };
  modeExtras: BuildAppChromeSourceInput['modeExtras'];
  tabs: BuildAppChromeSourceInput['tabs'];
  activeTabId: BuildAppChromeSourceInput['activeTabId'];
  onSelectTab: BuildAppChromeSourceInput['onSelectTab'];
  onCloseTab: BuildAppChromeSourceInput['onCloseTab'];
  documentChromeVisible: boolean;
  shortcutBindings: ShortcutBindings;
};

export function buildAppShellChromeInput(args: BuildAppShellChromeInputArgs): BuildAppChromeSourceInput {
  return {
    menus: args.menus,
    ...args.help,
    modeExtras: args.modeExtras,
    tabs: args.tabs,
    activeTabId: args.activeTabId,
    onSelectTab: args.onSelectTab,
    onCloseTab: args.onCloseTab,
    documentChromeVisible: args.documentChromeVisible,
    shortcutBindings: args.shortcutBindings,
  };
}
