import type { ComponentProps, ReactNode } from 'react';
import type { AppChrome } from './AppChrome';
import type { AppMenus } from '../menu/types';
import type { DocumentTabInfo } from '../app/documentSessionTypes';
import type { ShortcutBindings } from '../app/useShortcutBindingsState';

export type BuildChromeContextInput = {
  menus: AppMenus;
  showCommandPalette: boolean;
  showShortcutsHelp: boolean;
  showLicenses: boolean;
  showCredits: boolean;
  showAbout: boolean;
  onCloseCommandPalette: () => void;
  onCloseShortcutsHelp: () => void;
  onCloseLicenses: () => void;
  onCloseCredits: () => void;
  onCloseAbout: () => void;
  modeExtras: ReactNode;
  tabs: DocumentTabInfo[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  documentChromeVisible: boolean;
  shortcutBindings: ShortcutBindings;
};

export type AppChromeInput = ComponentProps<typeof AppChrome>;

export function buildChromeContext(input: BuildChromeContextInput): AppChromeInput {
  return input;
}
