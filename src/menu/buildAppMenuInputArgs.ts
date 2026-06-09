import type { AppPdfActions } from '../app/useAppPdfActions';
import type { DocumentState } from '../app/useAppDocumentState';
import type { AnnotationState } from '../app/useAnnotationDraftState';
import type { PanelsState } from '../app/useDocumentPanelsState';
import type { HelpState } from '../app/useHelpChromeState';
import type { ViewMode } from '../app/types';

export type BuildAppMenuInputArgs = {
  doc: Pick<DocumentState, 'filePath' | 'isDirty' | 'pageCount' | 'currentPage' | 'viewMode' | 'ocrAvailable'>;
  annotation: Pick<AnnotationState, 'highlightMode' | 'noteMode' | 'drawMode' | 'shapeMode' | 'stampMode' | 'redactMode' | 'imageInsertMode' | 'textEditMode' | 'vectorEditMode'>;
  panels: Pick<PanelsState, 'showFormsPanel' | 'showBookmarksPanel' | 'showSignaturesPanel'>;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  chrome: {
    guardUnsaved: (action: () => void) => void;
    closePdf: () => void;
    setViewMode: (mode: ViewMode) => void;
    setShowBookmarksPanel: PanelsState['setShowBookmarksPanel'];
    setShowPageEditsModal: AnnotationState['setShowPageEditsModal'];
    openTesseractGuide: () => void;
    openPdf: () => void;
    handlePrint: () => void;
    openSearchModal: () => void;
  };
  help: Pick<HelpState, 'setShowShortcutsHelp' | 'setShowLicenses' | 'setShowCredits' | 'setShowAbout' | 'setShowCommandPalette'>;
  pdfActions: AppPdfActions;
};
