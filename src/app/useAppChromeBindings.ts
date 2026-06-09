import { buildAppMenuInput } from '../menu/buildAppMenuInput';
import { buildModeToolbarExtras } from '../viewer/buildModeToolbarExtras';
import { buildAppKeyboardSource } from './buildAppKeyboardSource';
import { buildModalDismissInput } from './buildModalDismissInput';
import { useAppKeyboardBinding } from './useAppKeyboardBinding';
import { useModalDismiss, type UseModalDismissOptions } from './useModalDismiss';
import type { AppPdfActions } from './useAppPdfActions';
import type { AnnotationState } from './useAnnotationDraftState';
import type { DocumentState } from './useAppDocumentState';
import type { ModalState } from './useAppModalState';
import type { RefsState } from './useAppRefs';
import type { PanelsState } from './useDocumentPanelsState';
import type { HelpState } from './useHelpChromeState';
import type { SecurityState } from './useSecurityFormState';

export type UseAppChromeBindingsInput = {
  doc: DocumentState;
  modal: ModalState;
  security: SecurityState;
  panels: PanelsState;
  annotation: AnnotationState;
  help: HelpState;
  refs: Pick<RefsState, 'keyboardActionsRef'>;
  pdfActions: AppPdfActions;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  chrome: {
    guardUnsaved: (action: () => void) => void;
    closePdf: () => void;
    openPdf: () => void;
    goToPage: (page: number) => void;
    handlePrint: () => void;
    openSearchModal: () => void;
    openTesseractGuide: () => void;
  };
  zoom: { zoomIn: () => void; zoomOut: () => void; resetZoom: () => void };
  unsaved: Pick<UseModalDismissOptions, 'showUnsavedModal' | 'resolveUnsaved'>;
  browser: { showBrowserModal: boolean; setShowBrowserModal: (show: boolean) => void };
  search: { showSearchModal: boolean; closeSearchModal: () => void };
};

export function useAppChromeBindings(input: UseAppChromeBindingsInput) {
  const { dismissModals, anyModalOpen } = useModalDismiss(
    buildModalDismissInput({
      modal: input.modal,
      security: input.security,
      annotation: input.annotation,
      help: input.help,
      unsaved: input.unsaved,
      browser: input.browser,
      search: input.search,
    }),
  );

  useAppKeyboardBinding(
    input.refs.keyboardActionsRef,
    buildAppKeyboardSource({
      doc: {
        isDirty: input.doc.isDirty,
        filePath: input.doc.filePath,
        pageCount: input.doc.pageCount,
        currentPage: input.doc.currentPage,
        viewMode: input.doc.viewMode,
      },
      annotation: {
        noteMode: input.annotation.noteMode,
        drawMode: input.annotation.drawMode,
        shapeMode: input.annotation.shapeMode,
        stampMode: input.annotation.stampMode,
        redactMode: input.annotation.redactMode,
        imageInsertMode: input.annotation.imageInsertMode,
        textEditMode: input.annotation.textEditMode,
        vectorEditMode: input.annotation.vectorEditMode,
        formAddMode: input.annotation.formAddMode,
        highlightMode: input.annotation.highlightMode,
      },
      history: input.history,
      chrome: {
        anyModalOpen,
        dismissModals,
        guardUnsaved: input.chrome.guardUnsaved,
        closePdf: input.chrome.closePdf,
        openPdf: input.chrome.openPdf,
        setShowCommandPalette: input.help.setShowCommandPalette,
        goToPage: input.chrome.goToPage,
        handlePrint: input.chrome.handlePrint,
        openSearchModal: input.chrome.openSearchModal,
      },
      zoom: input.zoom,
      pdfActions: input.pdfActions,
    }),
  );

  const appMenus = buildAppMenuInput({
    doc: {
      filePath: input.doc.filePath,
      isDirty: input.doc.isDirty,
      pageCount: input.doc.pageCount,
      currentPage: input.doc.currentPage,
      viewMode: input.doc.viewMode,
      ocrAvailable: !!input.doc.ocrAvailable,
    },
    annotation: {
      highlightMode: input.annotation.highlightMode,
      noteMode: input.annotation.noteMode,
      drawMode: input.annotation.drawMode,
      shapeMode: input.annotation.shapeMode,
      stampMode: input.annotation.stampMode,
      redactMode: input.annotation.redactMode,
      imageInsertMode: input.annotation.imageInsertMode,
      textEditMode: input.annotation.textEditMode,
      vectorEditMode: input.annotation.vectorEditMode,
    },
    panels: {
      showFormsPanel: input.panels.showFormsPanel,
      showBookmarksPanel: input.panels.showBookmarksPanel,
      showSignaturesPanel: input.panels.showSignaturesPanel,
    },
    history: input.history,
    chrome: {
      guardUnsaved: input.chrome.guardUnsaved,
      closePdf: input.chrome.closePdf,
      setViewMode: input.doc.setViewMode,
      setShowBookmarksPanel: input.panels.setShowBookmarksPanel,
      setShowPageEditsModal: input.annotation.setShowPageEditsModal,
      openTesseractGuide: input.chrome.openTesseractGuide,
      openPdf: input.chrome.openPdf,
      handlePrint: input.chrome.handlePrint,
      openSearchModal: input.chrome.openSearchModal,
    },
    help: {
      setShowShortcutsHelp: input.help.setShowShortcutsHelp,
      setShowLicenses: input.help.setShowLicenses,
      setShowCredits: input.help.setShowCredits,
      setShowAbout: input.help.setShowAbout,
      setShowCommandPalette: input.help.setShowCommandPalette,
    },
    pdfActions: input.pdfActions,
  });

  const modeToolbarExtras = buildModeToolbarExtras({
    filePath: input.doc.filePath,
    imageInsertMode: input.annotation.imageInsertMode,
    imageSourcePath: input.annotation.imageSourcePath,
    onOpenImageInsertModal: input.pdfActions.openImageInsertModal,
    stampMode: input.annotation.stampMode,
    stampKind: input.annotation.stampKind,
    stampPreset: input.annotation.stampPreset,
    onStampKindChange: input.annotation.setStampKind,
    onStampPresetChange: input.annotation.setStampPreset,
    shapeMode: input.annotation.shapeMode,
    shapeKind: input.annotation.shapeKind,
    onShapeKindChange: input.annotation.setShapeKind,
  });

  return { dismissModals, anyModalOpen, appMenus, modeToolbarExtras };
}
