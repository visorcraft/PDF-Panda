import type { BuildAppMenuSourceInput } from '../menu/buildAppMenuSource';
import { buildAppMenuSourceInput } from '../menu/buildAppMenuSourceInput';
import type { AppPdfActions } from '../app/useAppPdfActions';
import type { useAppDocumentState } from '../app/useAppDocumentState';
import type { useAnnotationDraftState } from '../app/useAnnotationDraftState';
import type { useDocumentPanelsState } from '../app/useDocumentPanelsState';
import type { useHelpChromeState } from '../app/useHelpChromeState';
import type { ViewMode } from '../app/types';
import { menuInputDocFields } from './buildAppMenuInputDocFields';
import { menuInputPagesFields } from './buildAppMenuInputPagesFields';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type HelpState = ReturnType<typeof useHelpChromeState>;

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

export function buildAppMenuInput(args: BuildAppMenuInputArgs) {
  return buildAppMenuSourceInput({
    ...menuInputDocFields(args),
    ...menuInputPagesFields(args),
  } satisfies BuildAppMenuSourceInput);
}
