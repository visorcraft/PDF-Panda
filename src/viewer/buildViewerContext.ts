import type { ComponentProps } from 'react';
import type { AppBody } from './AppBody';
import type { PdfPageView } from './PdfPageView';
import type { PdfSidebar } from './PdfSidebar';
import type { ViewerMain } from './ViewerMain';
import type { WorkspaceViewMode } from '../app/types';
import type { BirdsEyeWorkspace } from '../app/useBirdsEyeWorkspace';

export type ViewerSidebarInput = ComponentProps<typeof PdfSidebar>;
export type ViewerPdfPageInput = ComponentProps<typeof PdfPageView>;
export type ViewerMainInput = Omit<ComponentProps<typeof ViewerMain>, 'filePath'> & {
  pdfPage: ViewerPdfPageInput;
};

export type BuildViewerContextInput = {
  filePath: string;
  sidebar: ViewerSidebarInput;
  viewer: ViewerMainInput;
  workspaceView: WorkspaceViewMode;
  birdsEye: BirdsEyeWorkspace;
};

export type AppBodyInput = ComponentProps<typeof AppBody>;

export function buildViewerContext(input: BuildViewerContextInput): AppBodyInput {
  return input;
}
