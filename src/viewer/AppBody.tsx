import type React from 'react';
import { E2EThrowTrigger } from '../ui/E2EThrowTrigger';
import { PdfSidebar } from './PdfSidebar';
import { ViewerMain } from './ViewerMain';

type AppBodyProps = {
  filePath: string;
  sidebar: React.ComponentProps<typeof PdfSidebar>;
  viewer: Omit<React.ComponentProps<typeof ViewerMain>, 'filePath'>;
};

export function AppBody({ filePath, sidebar, viewer }: AppBodyProps) {
  return (
    <div className="app-body">
      {filePath && <PdfSidebar {...sidebar} />}
      <div className="viewer-main" tabIndex={-1} aria-label="Document viewer">
        <ViewerMain {...viewer} filePath={filePath} />
      </div>
      <E2EThrowTrigger />
    </div>
  );
}
