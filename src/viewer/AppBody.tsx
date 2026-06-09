import type React from 'react';
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
      <ViewerMain {...viewer} filePath={filePath} />
    </div>
  );
}
