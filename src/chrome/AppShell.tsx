import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';
import { TabBar } from './TabBar';
import { Toast } from '../ui/Toast';
import { AppChrome } from './AppChrome';
import { AppBody } from '../viewer/AppBody';
import { AppModals } from '../modals/AppModals';
import { PrintSurface } from '../viewer/PrintSurface';
import type { DocumentTabInfo } from '../app/documentSessionTypes';

type ToastState = { message: string; type: 'success' | 'error' } | null;

type AppShellProps = {
  windowTitle: string;
  toast: ToastState;
  loading: boolean;
  tabs: DocumentTabInfo[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  chrome: React.ComponentProps<typeof AppChrome>;
  body: React.ComponentProps<typeof AppBody>;
  modals: React.ComponentProps<typeof AppModals>;
  printPages: string[];
  children?: ReactNode;
};

export function AppShell({
  windowTitle,
  toast,
  loading,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  chrome,
  body,
  modals,
  printPages,
}: AppShellProps) {
  return (
    <div className="app">
      <TitleBar title={windowTitle} />
      <TabBar tabs={tabs} activeId={activeTabId} onSelect={onSelectTab} onClose={onCloseTab} />
      <Toast notification={toast} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
        </div>
      )}

      <AppChrome {...chrome} />
      <AppBody {...body} />
      <AppModals {...modals} />
      <PrintSurface pages={printPages} />
    </div>
  );
}
