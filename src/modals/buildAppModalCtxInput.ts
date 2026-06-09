import type { BuildAppModalCtxSourceInput } from '../modals/buildAppModalCtxSource';
import { buildAppModalCtxSource } from './buildAppModalCtxSource';
import { modalCtxFileFields } from './buildAppModalCtxFileFields';
import { modalCtxPageFields } from './buildAppModalCtxPageFields';
import { modalCtxSecurityFields } from './buildAppModalCtxSecurityFields';
import { modalCtxAnnotFields } from './buildAppModalCtxAnnotFields';
import { modalCtxChromeFields } from './buildAppModalCtxChromeFields';
import type { AppPdfActions } from '../app/useAppPdfActions';
import type { useAppModalState } from '../app/useAppModalState';
import type { useSecurityFormState } from '../app/useSecurityFormState';
import type { useAnnotationDraftState } from '../app/useAnnotationDraftState';
import type { useAppDocumentState } from '../app/useAppDocumentState';
import type { useAppPageRanges } from '../app/useAppPageRanges';
import type { useHelpChromeState } from '../app/useHelpChromeState';
import type { PdfBrowserEntry, PdfBrowserListing } from './PdfBrowserModal';
import type { PdfBrowserTarget } from '../app/types';

type ModalState = ReturnType<typeof useAppModalState>;
type SecurityState = ReturnType<typeof useSecurityFormState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type DocumentState = ReturnType<typeof useAppDocumentState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;
type HelpState = ReturnType<typeof useHelpChromeState>;

export type BrowserSlice = {
  showBrowserModal: boolean;
  setShowBrowserModal: (show: boolean) => void;
  browserListing: PdfBrowserListing | null;
  browserPathInput: string;
  setBrowserPathInput: (v: string) => void;
  loadPdfBrowser: () => void | Promise<void>;
  openPdfBrowser: (target: PdfBrowserTarget) => void;
  commitBrowserPath: () => void;
  handleBrowserEntryClick: (entry: PdfBrowserEntry) => Promise<void>;
};

export type SearchSlice = {
  showSearchModal: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchMatchCase: boolean;
  setSearchMatchCase: (v: boolean) => void;
  searchWholeWord: boolean;
  setSearchWholeWord: (v: boolean) => void;
  searchResults: unknown;
  searchResultIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  closeSearchModal: () => void;
  runPdfSearch: () => void | Promise<void>;
  stepSearchMatch: (dir: 1 | -1) => void;
};

export type UnsavedSlice = {
  showUnsavedModal: boolean;
  resolveUnsaved: (choice: import('../modals/UnsavedChangesModal').UnsavedChoice) => void | Promise<void>;
};

export type TesseractSlice = {
  closeTesseractReminderModal: () => void;
};

export type LifecycleSlice = {
  handleOpenPdfPath: (path: string) => void | Promise<void>;
  handleOpenEncryptedPdf: () => void | Promise<void>;
  handleOpenRecentPdf: (path: string) => void | Promise<void>;
  loadPdfBrowser: () => void | Promise<void>;
  openPdfBrowser: (target: PdfBrowserTarget) => void;
};

export type RuntimeSlice = {
  showToast: (message: string, type?: 'success' | 'error') => void;
};

export type BuildAppModalCtxInputArgs = {
  modal: ModalState;
  security: SecurityState;
  annotation: AnnotationState;
  pageRanges: PageRangesState;
  doc: Pick<DocumentState, 'currentPage' | 'pageCount'>;
  browser: BrowserSlice;
  search: SearchSlice;
  unsaved: UnsavedSlice;
  tesseract: TesseractSlice;
  help: HelpState;
  lifecycle: LifecycleSlice;
  runtime: RuntimeSlice;
  pdfActions: AppPdfActions;
};

export function buildAppModalCtxInput(args: BuildAppModalCtxInputArgs) {
  return buildAppModalCtxSource({
    ...modalCtxFileFields(args),
    ...modalCtxPageFields(args),
    ...modalCtxSecurityFields(args),
    ...modalCtxAnnotFields(args),
    ...modalCtxChromeFields(args),
  } satisfies BuildAppModalCtxSourceInput);
}
