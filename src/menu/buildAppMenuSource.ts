import type { AppMenuContextSource } from './buildAppMenuContext';
import type { ViewMode } from '../app/types';

type VoidHandler = () => void | Promise<void>;
type SortHandler = (desc: boolean) => void | Promise<void>;

/** Inputs from App hooks/state before menu void-wrapping in buildAppMenuContext. */
export type BuildAppMenuSourceInput = {
  filePath: string;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pageCount: number | null;
  currentPage: number;
  viewMode: ViewMode;
  highlightMode: boolean;
  noteMode: boolean;
  drawMode: boolean;
  shapeMode: boolean;
  stampMode: boolean;
  redactMode: boolean;
  imageInsertMode: boolean;
  textEditMode: boolean;
  vectorEditMode: boolean;
  showFormsPanel: boolean;
  showBookmarksPanel: boolean;
  showSignaturesPanel: boolean;
  ocrAvailable: boolean | null;
  guardUnsaved: (action: () => void) => void;
  closePdf: () => void;
  setViewMode: (mode: ViewMode) => void;
  setShowBookmarksPanel: (fn: (prev: boolean) => boolean) => void;
  setShowPageEditsModal: (open: boolean) => void;
  setShowShortcutsHelp: (open: boolean) => void;
  setShowLicenses: (open: boolean) => void;
  setShowCredits: (open: boolean) => void;
  setShowAbout: (open: boolean) => void;
  setShowCommandPalette: (open: boolean) => void;
  openTesseractGuide: () => void;
  openPdf: () => void;
  handleSave: VoidHandler;
  openSaveAs: () => void;
  undo: VoidHandler;
  redo: VoidHandler;
  handlePrint: VoidHandler;
  openSearchModal: () => void;
  handleRotatePage: VoidHandler;
  handleRotatePageCcw: VoidHandler;
  handleResetPageRotation: VoidHandler;
  handleRotatePage180: VoidHandler;
  handleRotateAllPages: VoidHandler;
  handleRotateAllPagesCcw: VoidHandler;
  handleRotateAllPages180: VoidHandler;
  handleRotateOddPages: VoidHandler;
  handleRotateEvenPages: VoidHandler;
  handleRotateOddPagesCcw: VoidHandler;
  handleRotateEvenPagesCcw: VoidHandler;
  handleRotate180OddPages: VoidHandler;
  handleRotate180EvenPages: VoidHandler;
  handleResetRotationOddPages: VoidHandler;
  handleResetRotationEvenPages: VoidHandler;
  handleResetAllRotations: VoidHandler;
  openRotateRangeModal: () => void;
  handleDuplicatePage: VoidHandler;
  handleDuplicatePageBefore: VoidHandler;
  openDuplicateRangeModal: () => void;
  openParityRangeModal: () => void;
  openMoveRangeModal: () => void;
  openKeepRangeModal: () => void;
  handleKeepOddPages: VoidHandler;
  handleKeepEvenPages: VoidHandler;
  handleDeleteOddPages: VoidHandler;
  handleDeleteEvenPages: VoidHandler;
  handleAddBlankPage: VoidHandler;
  handleAddBlankPageBefore: VoidHandler;
  openInsertBlankPagesModal: () => void;
  handleInsertBlankBetweenPages: VoidHandler;
  handleInsertBlankBeforeOddPages: VoidHandler;
  handleInsertBlankBeforeEvenPages: VoidHandler;
  handleInsertBlankAfterOddPages: VoidHandler;
  handleInsertBlankAfterEvenPages: VoidHandler;
  handleMovePageToFirst: VoidHandler;
  handleMovePageToLast: VoidHandler;
  handleMovePageUp: VoidHandler;
  handleMovePageDown: VoidHandler;
  openSwapPagesModal: () => void;
  handleReversePages: VoidHandler;
  openReverseRangeModal: () => void;
  handleReverseOddPages: VoidHandler;
  handleReverseEvenPages: VoidHandler;
  handleMoveOddPagesToStart: VoidHandler;
  handleMoveEvenPagesToStart: VoidHandler;
  handleMoveOddPagesToEnd: VoidHandler;
  handleMoveEvenPagesToEnd: VoidHandler;
  handleSplitOddEven: VoidHandler;
  handleDuplicateAllPages: VoidHandler;
  handleDuplicatePageToEnd: VoidHandler;
  handleDuplicateOddPages: VoidHandler;
  handleDuplicateEvenPages: VoidHandler;
  handleDuplicateOddPagesBefore: VoidHandler;
  handleDuplicateEvenPagesBefore: VoidHandler;
  handleDuplicateOddPagesToEnd: VoidHandler;
  handleDuplicateEvenPagesToEnd: VoidHandler;
  handleDuplicateOddPagesToStart: VoidHandler;
  handleDuplicateEvenPagesToStart: VoidHandler;
  openDeleteModal: () => void;
  openDeleteRangeModal: () => void;
  openDeleteNthModal: () => void;
  openInsertModal: () => void;
  openMergeModal: () => void;
  openInterleaveModal: () => void;
  openPrependModal: () => void;
  openReplacePageModal: () => void;
  openSplitModal: () => void;
  openSplitAtModal: () => void;
  openSplitEveryModal: () => void;
  openExtractModal: () => void;
  openExtractOddModal: () => void;
  openExtractEvenModal: () => void;
  toggleMarkdownView: VoidHandler;
  handleOptimizePdf: VoidHandler;
  openExportPngModal: () => void;
  openExportPagePdfModal: () => void;
  openExportPagesPdfModal: () => void;
  openInsertImagePageModal: () => void;
  openPageNumbersModal: () => void;
  openPageHeaderModal: () => void;
  openPageFooterModal: () => void;
  openPageSizeModal: () => void;
  openWatermarkModal: () => void;
  openCropModal: () => void;
  openCropRangeModal: () => void;
  handleCropOddPages: VoidHandler;
  handleCropEvenPages: VoidHandler;
  openExpandMarginsModal: () => void;
  openShrinkMarginsModal: () => void;
  openPageBorderModal: () => void;
  openFlattenModal: () => void;
  handleFlattenAllAnnotations: VoidHandler;
  handleFlattenOddPages: VoidHandler;
  handleFlattenEvenPages: VoidHandler;
  handleSortPagesBySize: SortHandler;
  handleSortOddPagesBySize: SortHandler;
  handleSortEvenPagesBySize: SortHandler;
  handleSortPagesByRotation: SortHandler;
  handleSortOddPagesByRotation: SortHandler;
  handleSortEvenPagesByRotation: SortHandler;
  openMetadataModal: VoidHandler;
  handleSummarizePdf: VoidHandler;
  openProtectModal: () => void;
  openDecryptModal: () => void;
  openSignModal: () => void;
  toggleSignaturesPanel: () => void;
  toggleRedactMode: () => void;
  toggleHighlightMode: () => void;
  toggleNoteMode: () => void;
  toggleDrawMode: () => void;
  toggleShapeMode: () => void;
  toggleStampMode: () => void;
  toggleImageInsertMode: () => void;
  toggleTextEditMode: () => void;
  toggleVectorEditMode: () => void;
  toggleFormsPanel: () => void;
};

export function buildAppMenuSource(input: BuildAppMenuSourceInput): AppMenuContextSource {
  return {
    hasPdf: !!input.filePath,
    isDirty: input.isDirty,
    canUndo: input.canUndo,
    canRedo: input.canRedo,
    pageCount: input.pageCount,
    currentPage: input.currentPage,
    viewMode: input.viewMode,
    highlightMode: input.highlightMode,
    noteMode: input.noteMode,
    drawMode: input.drawMode,
    shapeMode: input.shapeMode,
    stampMode: input.stampMode,
    redactMode: input.redactMode,
    imageInsertMode: input.imageInsertMode,
    textEditMode: input.textEditMode,
    vectorEditMode: input.vectorEditMode,
    showFormsPanel: input.showFormsPanel,
    showBookmarksPanel: input.showBookmarksPanel,
    showSignaturesPanel: input.showSignaturesPanel,
    tesseractInstalled: input.ocrAvailable === true,
    openPdf: input.openPdf,
    handleSave: input.handleSave,
    openSaveAs: input.openSaveAs,
    requestClosePdf: () => input.guardUnsaved(input.closePdf),
    undo: input.undo,
    redo: input.redo,
    handlePrint: input.handlePrint,
    openSearchModal: input.openSearchModal,
    handleRotatePage: input.handleRotatePage,
    handleRotatePageCcw: input.handleRotatePageCcw,
    handleResetPageRotation: input.handleResetPageRotation,
    handleRotatePage180: input.handleRotatePage180,
    handleRotateAllPages: input.handleRotateAllPages,
    handleRotateAllPagesCcw: input.handleRotateAllPagesCcw,
    handleRotateAllPages180: input.handleRotateAllPages180,
    handleRotateOddPages: input.handleRotateOddPages,
    handleRotateEvenPages: input.handleRotateEvenPages,
    handleRotateOddPagesCcw: input.handleRotateOddPagesCcw,
    handleRotateEvenPagesCcw: input.handleRotateEvenPagesCcw,
    handleRotate180OddPages: input.handleRotate180OddPages,
    handleRotate180EvenPages: input.handleRotate180EvenPages,
    handleResetRotationOddPages: input.handleResetRotationOddPages,
    handleResetRotationEvenPages: input.handleResetRotationEvenPages,
    handleResetAllRotations: input.handleResetAllRotations,
    openRotateRangeModal: input.openRotateRangeModal,
    handleDuplicatePage: input.handleDuplicatePage,
    handleDuplicatePageBefore: input.handleDuplicatePageBefore,
    openDuplicateRangeModal: input.openDuplicateRangeModal,
    openParityRangeModal: input.openParityRangeModal,
    openMoveRangeModal: input.openMoveRangeModal,
    openKeepRangeModal: input.openKeepRangeModal,
    handleKeepOddPages: input.handleKeepOddPages,
    handleKeepEvenPages: input.handleKeepEvenPages,
    handleDeleteOddPages: input.handleDeleteOddPages,
    handleDeleteEvenPages: input.handleDeleteEvenPages,
    handleAddBlankPage: input.handleAddBlankPage,
    handleAddBlankPageBefore: input.handleAddBlankPageBefore,
    openInsertBlankPagesModal: input.openInsertBlankPagesModal,
    handleInsertBlankBetweenPages: input.handleInsertBlankBetweenPages,
    handleInsertBlankBeforeOddPages: input.handleInsertBlankBeforeOddPages,
    handleInsertBlankBeforeEvenPages: input.handleInsertBlankBeforeEvenPages,
    handleInsertBlankAfterOddPages: input.handleInsertBlankAfterOddPages,
    handleInsertBlankAfterEvenPages: input.handleInsertBlankAfterEvenPages,
    handleMovePageToFirst: input.handleMovePageToFirst,
    handleMovePageToLast: input.handleMovePageToLast,
    handleMovePageUp: input.handleMovePageUp,
    handleMovePageDown: input.handleMovePageDown,
    openSwapPagesModal: input.openSwapPagesModal,
    handleReversePages: input.handleReversePages,
    openReverseRangeModal: input.openReverseRangeModal,
    handleReverseOddPages: input.handleReverseOddPages,
    handleReverseEvenPages: input.handleReverseEvenPages,
    handleMoveOddPagesToStart: input.handleMoveOddPagesToStart,
    handleMoveEvenPagesToStart: input.handleMoveEvenPagesToStart,
    handleMoveOddPagesToEnd: input.handleMoveOddPagesToEnd,
    handleMoveEvenPagesToEnd: input.handleMoveEvenPagesToEnd,
    handleSplitOddEven: input.handleSplitOddEven,
    handleDuplicateAllPages: input.handleDuplicateAllPages,
    handleDuplicatePageToEnd: input.handleDuplicatePageToEnd,
    handleDuplicateOddPages: input.handleDuplicateOddPages,
    handleDuplicateEvenPages: input.handleDuplicateEvenPages,
    handleDuplicateOddPagesBefore: input.handleDuplicateOddPagesBefore,
    handleDuplicateEvenPagesBefore: input.handleDuplicateEvenPagesBefore,
    handleDuplicateOddPagesToEnd: input.handleDuplicateOddPagesToEnd,
    handleDuplicateEvenPagesToEnd: input.handleDuplicateEvenPagesToEnd,
    handleDuplicateOddPagesToStart: input.handleDuplicateOddPagesToStart,
    handleDuplicateEvenPagesToStart: input.handleDuplicateEvenPagesToStart,
    openDeleteModal: input.openDeleteModal,
    openDeleteRangeModal: input.openDeleteRangeModal,
    openDeleteNthModal: input.openDeleteNthModal,
    openInsertModal: input.openInsertModal,
    openMergeModal: input.openMergeModal,
    openInterleaveModal: input.openInterleaveModal,
    openPrependModal: input.openPrependModal,
    openReplacePageModal: input.openReplacePageModal,
    openSplitModal: input.openSplitModal,
    openSplitAtModal: input.openSplitAtModal,
    openSplitEveryModal: input.openSplitEveryModal,
    openExtractModal: input.openExtractModal,
    openExtractOddModal: input.openExtractOddModal,
    openExtractEvenModal: input.openExtractEvenModal,
    setViewModePdf: () => input.setViewMode('pdf'),
    toggleMarkdownView: input.toggleMarkdownView,
    handleOptimizePdf: input.handleOptimizePdf,
    openExportPngModal: input.openExportPngModal,
    openExportPagePdfModal: input.openExportPagePdfModal,
    openExportPagesPdfModal: input.openExportPagesPdfModal,
    openInsertImagePageModal: input.openInsertImagePageModal,
    openPageNumbersModal: input.openPageNumbersModal,
    openPageHeaderModal: input.openPageHeaderModal,
    openPageFooterModal: input.openPageFooterModal,
    openPageSizeModal: input.openPageSizeModal,
    openWatermarkModal: input.openWatermarkModal,
    openCropModal: input.openCropModal,
    openCropRangeModal: input.openCropRangeModal,
    handleCropOddPages: input.handleCropOddPages,
    handleCropEvenPages: input.handleCropEvenPages,
    openExpandMarginsModal: input.openExpandMarginsModal,
    openShrinkMarginsModal: input.openShrinkMarginsModal,
    openPageBorderModal: input.openPageBorderModal,
    openFlattenModal: input.openFlattenModal,
    handleFlattenAllAnnotations: input.handleFlattenAllAnnotations,
    handleFlattenOddPages: input.handleFlattenOddPages,
    handleFlattenEvenPages: input.handleFlattenEvenPages,
    handleSortPagesBySize: input.handleSortPagesBySize,
    handleSortOddPagesBySize: input.handleSortOddPagesBySize,
    handleSortEvenPagesBySize: input.handleSortEvenPagesBySize,
    handleSortPagesByRotation: input.handleSortPagesByRotation,
    handleSortOddPagesByRotation: input.handleSortOddPagesByRotation,
    handleSortEvenPagesByRotation: input.handleSortEvenPagesByRotation,
    openMetadataModal: input.openMetadataModal,
    handleSummarizePdf: input.handleSummarizePdf,
    openProtectModal: input.openProtectModal,
    openDecryptModal: input.openDecryptModal,
    openSignModal: input.openSignModal,
    toggleSignaturesPanel: input.toggleSignaturesPanel,
    toggleBookmarksPanel: () => input.setShowBookmarksPanel((prev) => !prev),
    toggleRedactMode: input.toggleRedactMode,
    toggleHighlightMode: input.toggleHighlightMode,
    toggleNoteMode: input.toggleNoteMode,
    toggleDrawMode: input.toggleDrawMode,
    toggleShapeMode: input.toggleShapeMode,
    toggleStampMode: input.toggleStampMode,
    toggleImageInsertMode: input.toggleImageInsertMode,
    toggleTextEditMode: input.toggleTextEditMode,
    toggleVectorEditMode: input.toggleVectorEditMode,
    openPageEditsModal: () => input.setShowPageEditsModal(true),
    toggleFormsPanel: input.toggleFormsPanel,
    openTesseractGuide: input.openTesseractGuide,
    openShortcutsHelp: () => input.setShowShortcutsHelp(true),
    openLicenses: () => input.setShowLicenses(true),
    openCredits: () => input.setShowCredits(true),
    openAbout: () => input.setShowAbout(true),
    openCommandPalette: () => input.setShowCommandPalette(true),
  };
}
