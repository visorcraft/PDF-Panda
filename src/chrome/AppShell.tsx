import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';
import { ResizeBorders } from './ResizeBorders';
import { Toast } from '../ui/Toast';
import { AppChrome } from './AppChrome';
import { useFocusCycle } from './useFocusCycle';
import { AppBody } from '../viewer/AppBody';
import { AppModals } from '../modals/AppModals';
import { PrintSurface } from '../viewer/PrintSurface';
import { SettingsPage } from '../settings/SettingsPage';
import type { ShortcutBindingsState } from '../app/useShortcutBindingsState';
import type { AppearanceKey } from '../settings/appearancePalettes';
import type { SettingsFocusSection } from '../app/useAppSurfaceState';

type ToastState = { message: string; type: 'success' | 'error' } | null;

type AppSurface = import('../app/useAppSurfaceState').AppSurface;

type AppShellProps = {
  windowTitle: string;
  toast: ToastState;
  loading: boolean;
  chrome: React.ComponentProps<typeof AppChrome>;
  body: React.ComponentProps<typeof AppBody>;
  modals: React.ComponentProps<typeof AppModals>;
  printPages: string[];
  activeSurface: AppSurface;
  settingsFocus: SettingsFocusSection;
  closeSettings: () => void;
  shortcuts: ShortcutBindingsState;
  appearance: { appearance: AppearanceKey; setAppearance: (key: AppearanceKey) => void };
  children?: ReactNode;
};

export function AppShell({
  windowTitle,
  toast,
  loading,
  chrome,
  body,
  modals,
  printPages,
  activeSurface,
  settingsFocus,
  closeSettings,
  shortcuts,
  appearance,
}: AppShellProps) {
  const hasDocument = !!body.filePath;
  useFocusCycle(activeSurface === 'document');
  return (
    <div className="app" data-active-surface={activeSurface}>
      <ResizeBorders />
      <TitleBar title={windowTitle} />
      <Toast notification={toast} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
        </div>
      )}

      <AppChrome {...chrome} documentChromeVisible={activeSurface === 'document'} shortcutBindings={shortcuts.bindings} />
      {activeSurface === 'settings' ? (
        <SettingsPage
          closeSettings={closeSettings}
          hasDocument={hasDocument}
          focusSection={settingsFocus}
          appearance={appearance}
          shortcuts={shortcuts}
        />
      ) : (
        <AppBody {...body} />
      )}
      <AppModals {...modals} />
      <PrintSurface pages={printPages} />
    </div>
  );
}
