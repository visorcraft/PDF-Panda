import type { ComponentProps, ReactNode } from 'react';
import { MenuChrome } from '../menu/MenuChrome';
import type { AppMenus } from '../menu/types';
import { PageControls } from '../viewer/PageControls';

type AppChromeProps = {
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

export function AppChrome({
  menus,
  showCommandPalette,
  showShortcutsHelp,
  showLicenses,
  showCredits,
  showAbout,
  onCloseCommandPalette,
  onCloseShortcutsHelp,
  onCloseLicenses,
  onCloseCredits,
  onCloseAbout,
  modeExtras,
  showPageControls,
  pageControls,
}: AppChromeProps) {
  return (
    <div className="app-chrome">
      <MenuChrome
        menus={menus.menus}
        quickAccess={menus.quickAccess}
        allActions={menus.allActions}
        showCommandPalette={showCommandPalette}
        showShortcutsHelp={showShortcutsHelp}
        showLicenses={showLicenses}
        showCredits={showCredits}
        showAbout={showAbout}
        onCloseCommandPalette={onCloseCommandPalette}
        onCloseShortcutsHelp={onCloseShortcutsHelp}
        onCloseLicenses={onCloseLicenses}
        onCloseCredits={onCloseCredits}
        onCloseAbout={onCloseAbout}
        modeExtras={modeExtras}
      />
      {showPageControls && pageControls && <PageControls {...pageControls} />}
    </div>
  );
}
