import type { ComponentProps, ReactNode } from 'react';
import type { AppChrome } from './AppChrome';
import type { buildAppMenus } from '../menu/buildAppMenus';
import { PageControls } from '../viewer/PageControls';

type AppMenus = ReturnType<typeof buildAppMenus>;

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
  showPageControls: boolean;
  pageControls: ComponentProps<typeof PageControls> | null;
};

export type AppChromeInput = ComponentProps<typeof AppChrome>;

export function buildChromeContext(input: BuildChromeContextInput): AppChromeInput {
  return input;
}
