import type { BuildAppMenuSourceInput } from '../menu/buildAppMenuSource';
import { buildAppMenuSourceInput } from '../menu/buildAppMenuSourceInput';
import type { AppPdfActions } from '../app/useAppPdfActions';
import type { useAppDocumentState } from '../app/useAppDocumentState';
import type { useAnnotationDraftState } from '../app/useAnnotationDraftState';
import type { useDocumentPanelsState } from '../app/useDocumentPanelsState';
import type { useHelpChromeState } from '../app/useHelpChromeState';
import type { ViewMode } from '../app/types';

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
    filePath: args.doc.filePath,
    isDirty: args.doc.isDirty,
    canUndo: args.history.canUndo,
    canRedo: args.history.canRedo,
    pageCount: args.doc.pageCount,
    currentPage: args.doc.currentPage,
    viewMode: args.doc.viewMode,
    highlightMode: args.annotation.highlightMode,
    noteMode: args.annotation.noteMode,
    drawMode: args.annotation.drawMode,
    shapeMode: args.annotation.shapeMode,
    stampMode: args.annotation.stampMode,
    redactMode: args.annotation.redactMode,
    imageInsertMode: args.annotation.imageInsertMode,
    textEditMode: args.annotation.textEditMode,
    vectorEditMode: args.annotation.vectorEditMode,
    showFormsPanel: args.panels.showFormsPanel,
    showBookmarksPanel: args.panels.showBookmarksPanel,
    showSignaturesPanel: args.panels.showSignaturesPanel,
    ocrAvailable: args.doc.ocrAvailable,
    guardUnsaved: args.chrome.guardUnsaved,
    closePdf: args.chrome.closePdf,
    setViewMode: args.chrome.setViewMode,
    setShowBookmarksPanel: args.chrome.setShowBookmarksPanel,
    setShowPageEditsModal: args.chrome.setShowPageEditsModal,
    setShowShortcutsHelp: args.help.setShowShortcutsHelp,
    setShowLicenses: args.help.setShowLicenses,
    setShowCredits: args.help.setShowCredits,
    setShowAbout: args.help.setShowAbout,
    setShowCommandPalette: args.help.setShowCommandPalette,
    openTesseractGuide: args.chrome.openTesseractGuide,
    openPdf: args.chrome.openPdf,
    handleAddBlankPage: args.pdfActions.handleAddBlankPage,
    handleAddBlankPageBefore: args.pdfActions.handleAddBlankPageBefore,
    handleCropEvenPages: args.pdfActions.handleCropEvenPages,
    handleCropOddPages: args.pdfActions.handleCropOddPages,
    handleDeleteEvenPages: args.pdfActions.handleDeleteEvenPages,
    handleDeleteOddPages: args.pdfActions.handleDeleteOddPages,
    handleDuplicateAllPages: args.pdfActions.handleDuplicateAllPages,
    handleDuplicateEvenPages: args.pdfActions.handleDuplicateEvenPages,
    handleDuplicateEvenPagesBefore: args.pdfActions.handleDuplicateEvenPagesBefore,
    handleDuplicateEvenPagesToEnd: args.pdfActions.handleDuplicateEvenPagesToEnd,
    handleDuplicateEvenPagesToStart: args.pdfActions.handleDuplicateEvenPagesToStart,
    handleDuplicateOddPages: args.pdfActions.handleDuplicateOddPages,
    handleDuplicateOddPagesBefore: args.pdfActions.handleDuplicateOddPagesBefore,
    handleDuplicateOddPagesToEnd: args.pdfActions.handleDuplicateOddPagesToEnd,
    handleDuplicateOddPagesToStart: args.pdfActions.handleDuplicateOddPagesToStart,
    handleDuplicatePage: args.pdfActions.handleDuplicatePage,
    handleDuplicatePageBefore: args.pdfActions.handleDuplicatePageBefore,
    handleDuplicatePageToEnd: args.pdfActions.handleDuplicatePageToEnd,
    handleFlattenAllAnnotations: args.pdfActions.handleFlattenAllAnnotations,
    handleFlattenEvenPages: args.pdfActions.handleFlattenEvenPages,
    handleFlattenOddPages: args.pdfActions.handleFlattenOddPages,
    handleInsertBlankAfterEvenPages: args.pdfActions.handleInsertBlankAfterEvenPages,
    handleInsertBlankAfterOddPages: args.pdfActions.handleInsertBlankAfterOddPages,
    handleInsertBlankBeforeEvenPages: args.pdfActions.handleInsertBlankBeforeEvenPages,
    handleInsertBlankBeforeOddPages: args.pdfActions.handleInsertBlankBeforeOddPages,
    handleInsertBlankBetweenPages: args.pdfActions.handleInsertBlankBetweenPages,
    handleKeepEvenPages: args.pdfActions.handleKeepEvenPages,
    handleKeepOddPages: args.pdfActions.handleKeepOddPages,
    handleMoveEvenPagesToEnd: args.pdfActions.handleMoveEvenPagesToEnd,
    handleMoveEvenPagesToStart: args.pdfActions.handleMoveEvenPagesToStart,
    handleMoveOddPagesToEnd: args.pdfActions.handleMoveOddPagesToEnd,
    handleMoveOddPagesToStart: args.pdfActions.handleMoveOddPagesToStart,
    handleMovePageDown: args.pdfActions.handleMovePageDown,
    handleMovePageToFirst: args.pdfActions.handleMovePageToFirst,
    handleMovePageToLast: args.pdfActions.handleMovePageToLast,
    handleMovePageUp: args.pdfActions.handleMovePageUp,
    handleOptimizePdf: args.pdfActions.handleOptimizePdf,
    handlePrint: args.chrome.handlePrint,
    handleResetAllRotations: args.pdfActions.handleResetAllRotations,
    handleResetPageRotation: args.pdfActions.handleResetPageRotation,
    handleResetRotationEvenPages: args.pdfActions.handleResetRotationEvenPages,
    handleResetRotationOddPages: args.pdfActions.handleResetRotationOddPages,
    handleReverseEvenPages: args.pdfActions.handleReverseEvenPages,
    handleReverseOddPages: args.pdfActions.handleReverseOddPages,
    handleReversePages: args.pdfActions.handleReversePages,
    handleRotate180EvenPages: args.pdfActions.handleRotate180EvenPages,
    handleRotate180OddPages: args.pdfActions.handleRotate180OddPages,
    handleRotateAllPages: args.pdfActions.handleRotateAllPages,
    handleRotateAllPages180: args.pdfActions.handleRotateAllPages180,
    handleRotateAllPagesCcw: args.pdfActions.handleRotateAllPagesCcw,
    handleRotateEvenPages: args.pdfActions.handleRotateEvenPages,
    handleRotateEvenPagesCcw: args.pdfActions.handleRotateEvenPagesCcw,
    handleRotateOddPages: args.pdfActions.handleRotateOddPages,
    handleRotateOddPagesCcw: args.pdfActions.handleRotateOddPagesCcw,
    handleRotatePage: args.pdfActions.handleRotatePage,
    handleRotatePage180: args.pdfActions.handleRotatePage180,
    handleRotatePageCcw: args.pdfActions.handleRotatePageCcw,
    handleSave: args.pdfActions.handleSave,
    handleSortEvenPagesByRotation: args.pdfActions.handleSortEvenPagesByRotation,
    handleSortEvenPagesBySize: args.pdfActions.handleSortEvenPagesBySize,
    handleSortOddPagesByRotation: args.pdfActions.handleSortOddPagesByRotation,
    handleSortOddPagesBySize: args.pdfActions.handleSortOddPagesBySize,
    handleSortPagesByRotation: args.pdfActions.handleSortPagesByRotation,
    handleSortPagesBySize: args.pdfActions.handleSortPagesBySize,
    handleSplitOddEven: args.pdfActions.handleSplitOddEven,
    handleSummarizePdf: args.pdfActions.handleSummarizePdf,
    openCropModal: args.pdfActions.openCropModal,
    openCropRangeModal: args.pdfActions.openCropRangeModal,
    openDecryptModal: args.pdfActions.openDecryptModal,
    openDeleteModal: args.pdfActions.openDeleteModal,
    openDeleteNthModal: args.pdfActions.openDeleteNthModal,
    openDeleteRangeModal: args.pdfActions.openDeleteRangeModal,
    openDuplicateRangeModal: args.pdfActions.openDuplicateRangeModal,
    openExpandMarginsModal: args.pdfActions.openExpandMarginsModal,
    openExportPagePdfModal: args.pdfActions.openExportPagePdfModal,
    openExportPagesPdfModal: args.pdfActions.openExportPagesPdfModal,
    openExportPngModal: args.pdfActions.openExportPngModal,
    openExtractEvenModal: args.pdfActions.openExtractEvenModal,
    openExtractModal: args.pdfActions.openExtractModal,
    openExtractOddModal: args.pdfActions.openExtractOddModal,
    openFlattenModal: args.pdfActions.openFlattenModal,
    openInsertBlankPagesModal: args.pdfActions.openInsertBlankPagesModal,
    openInsertImagePageModal: args.pdfActions.openInsertImagePageModal,
    openInsertModal: args.pdfActions.openInsertModal,
    openInterleaveModal: args.pdfActions.openInterleaveModal,
    openKeepRangeModal: args.pdfActions.openKeepRangeModal,
    openMergeModal: args.pdfActions.openMergeModal,
    openMetadataModal: args.pdfActions.openMetadataModal,
    openMoveRangeModal: args.pdfActions.openMoveRangeModal,
    openPageBorderModal: args.pdfActions.openPageBorderModal,
    openPageFooterModal: args.pdfActions.openPageFooterModal,
    openPageHeaderModal: args.pdfActions.openPageHeaderModal,
    openPageNumbersModal: args.pdfActions.openPageNumbersModal,
    openPageSizeModal: args.pdfActions.openPageSizeModal,
    openParityRangeModal: args.pdfActions.openParityRangeModal,
    openPrependModal: args.pdfActions.openPrependModal,
    openProtectModal: args.pdfActions.openProtectModal,
    openReplacePageModal: args.pdfActions.openReplacePageModal,
    openReverseRangeModal: args.pdfActions.openReverseRangeModal,
    openRotateRangeModal: args.pdfActions.openRotateRangeModal,
    openSaveAs: args.pdfActions.openSaveAs,
    openSearchModal: args.chrome.openSearchModal,
    openShrinkMarginsModal: args.pdfActions.openShrinkMarginsModal,
    openSignModal: args.pdfActions.openSignModal,
    openSplitAtModal: args.pdfActions.openSplitAtModal,
    openSplitEveryModal: args.pdfActions.openSplitEveryModal,
    openSplitModal: args.pdfActions.openSplitModal,
    openSwapPagesModal: args.pdfActions.openSwapPagesModal,
    openWatermarkModal: args.pdfActions.openWatermarkModal,
    redo: args.history.redo,
    toggleDrawMode: args.pdfActions.toggleDrawMode,
    toggleFormsPanel: args.pdfActions.toggleFormsPanel,
    toggleHighlightMode: args.pdfActions.toggleHighlightMode,
    toggleImageInsertMode: args.pdfActions.toggleImageInsertMode,
    toggleMarkdownView: args.pdfActions.toggleMarkdownView,
    toggleNoteMode: args.pdfActions.toggleNoteMode,
    toggleRedactMode: args.pdfActions.toggleRedactMode,
    toggleShapeMode: args.pdfActions.toggleShapeMode,
    toggleSignaturesPanel: args.pdfActions.toggleSignaturesPanel,
    toggleStampMode: args.pdfActions.toggleStampMode,
    toggleTextEditMode: args.pdfActions.toggleTextEditMode,
    toggleVectorEditMode: args.pdfActions.toggleVectorEditMode,
    undo: args.history.undo,
  } satisfies BuildAppMenuSourceInput);
}
