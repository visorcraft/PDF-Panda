import type { AppPdfActions } from '../app/useAppPdfActions';
import type { DocumentState } from '../app/useAppDocumentState';
import type { AnnotationState } from '../app/useAnnotationDraftState';
import type { PanelsState } from '../app/useDocumentPanelsState';
import type { HelpState } from '../app/useHelpChromeState';
import type { ViewMode } from '../app/types';
import type { AppSurface, SettingsFocusSection } from '../app/useAppSurfaceState';

export type BuildAppMenuInputArgs = {
  doc: Pick<DocumentState, 'filePath' | 'isDirty' | 'pageCount' | 'currentPage' | 'viewMode' | 'scrollViewMode' | 'ocrAvailable'>;
  annotation: Pick<AnnotationState, 'highlightMode' | 'noteMode' | 'drawMode' | 'shapeMode' | 'stampMode' | 'redactMode' | 'imageInsertMode' | 'textEditMode' | 'editTextRunMode' | 'vectorEditMode'>;
  panels: Pick<PanelsState, 'showFormsPanel' | 'showBookmarksPanel' | 'showSignaturesPanel' | 'showAnnotationsPanel'>;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  chrome: {
    guardUnsaved: (action: () => void) => void;
    closePdf: () => void;
    setViewMode: (mode: ViewMode) => void;
    setScrollViewMode: DocumentState['setScrollViewMode'];
    setShowBookmarksPanel: PanelsState['setShowBookmarksPanel'];
    setShowAnnotationsPanel: PanelsState['setShowAnnotationsPanel'];
    setShowPageEditsModal: AnnotationState['setShowPageEditsModal'];
    openTesseractGuide: () => void;
    openPdf: () => void;
    handlePrint: () => void;
    openSearchModal: () => void;
  };
  help: Pick<HelpState, 'setShowShortcutsHelp' | 'setShowLicenses' | 'setShowCredits' | 'setShowAbout' | 'setShowUpdateModal' | 'updaterSupported' | 'setShowCommandPalette'>;
  theme: 'system' | 'light' | 'dark';
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  surface: { activeSurface: AppSurface; openSettings: (focus?: SettingsFocusSection) => void };
  pdfActions: AppPdfActions;
};
