import type { AppMenuContext } from './types';

type VoidHandler = () => void | Promise<void>;
type SortHandler = (desc: boolean) => void | Promise<void>;

/** Raw handlers from App before menu-specific void wrapping. */
export type AppMenuContextSource = {
  hasPdf: boolean;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pageCount: number | null;
  currentPage: number;
  viewMode: 'pdf' | 'markdown';
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
  tesseractInstalled: boolean;
  openPdf: () => void;
  handleSave: VoidHandler;
  openSaveAs: () => void;
  requestClosePdf: () => void;
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
  setViewModePdf: () => void;
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
  toggleBookmarksPanel: () => void;
  toggleRedactMode: () => void;
  toggleHighlightMode: () => void;
  toggleNoteMode: () => void;
  toggleDrawMode: () => void;
  toggleShapeMode: () => void;
  toggleStampMode: () => void;
  toggleImageInsertMode: () => void;
  toggleTextEditMode: () => void;
  toggleVectorEditMode: () => void;
  openPageEditsModal: () => void;
  toggleFormsPanel: () => void;
  openTesseractGuide: () => void;
  openShortcutsHelp: () => void;
  openLicenses: () => void;
  openCredits: () => void;
  openAbout: () => void;
  openCommandPalette: () => void;
};

const voidRun = (fn: VoidHandler): (() => void) => () => { void fn(); };

const voidSort = (fn: SortHandler): ((desc: boolean) => void) => (desc) => { void fn(desc); };

export function buildAppMenuContext(source: AppMenuContextSource): AppMenuContext {
  return {
    hasPdf: source.hasPdf,
    isDirty: source.isDirty,
    canUndo: source.canUndo,
    canRedo: source.canRedo,
    pageCount: source.pageCount,
    currentPage: source.currentPage,
    viewMode: source.viewMode,
    highlightMode: source.highlightMode,
    noteMode: source.noteMode,
    drawMode: source.drawMode,
    shapeMode: source.shapeMode,
    stampMode: source.stampMode,
    redactMode: source.redactMode,
    imageInsertMode: source.imageInsertMode,
    textEditMode: source.textEditMode,
    vectorEditMode: source.vectorEditMode,
    showFormsPanel: source.showFormsPanel,
    showBookmarksPanel: source.showBookmarksPanel,
    showSignaturesPanel: source.showSignaturesPanel,
    tesseractInstalled: source.tesseractInstalled,
    openPdf: source.openPdf,
    handleSave: source.handleSave,
    openSaveAs: source.openSaveAs,
    requestClosePdf: source.requestClosePdf,
    undo: source.undo,
    redo: source.redo,
    handlePrint: source.handlePrint,
    openSearchModal: source.openSearchModal,
    handleRotatePage: source.handleRotatePage,
    handleRotatePageCcw: voidRun(source.handleRotatePageCcw),
    handleResetPageRotation: voidRun(source.handleResetPageRotation),
    handleRotatePage180: voidRun(source.handleRotatePage180),
    handleRotateAllPages: voidRun(source.handleRotateAllPages),
    handleRotateAllPagesCcw: voidRun(source.handleRotateAllPagesCcw),
    handleRotateAllPages180: voidRun(source.handleRotateAllPages180),
    handleRotateOddPages: voidRun(source.handleRotateOddPages),
    handleRotateEvenPages: voidRun(source.handleRotateEvenPages),
    handleRotateOddPagesCcw: voidRun(source.handleRotateOddPagesCcw),
    handleRotateEvenPagesCcw: voidRun(source.handleRotateEvenPagesCcw),
    handleRotate180OddPages: voidRun(source.handleRotate180OddPages),
    handleRotate180EvenPages: voidRun(source.handleRotate180EvenPages),
    handleResetRotationOddPages: voidRun(source.handleResetRotationOddPages),
    handleResetRotationEvenPages: voidRun(source.handleResetRotationEvenPages),
    handleResetAllRotations: voidRun(source.handleResetAllRotations),
    openRotateRangeModal: source.openRotateRangeModal,
    handleDuplicatePage: source.handleDuplicatePage,
    handleDuplicatePageBefore: voidRun(source.handleDuplicatePageBefore),
    openDuplicateRangeModal: source.openDuplicateRangeModal,
    openParityRangeModal: source.openParityRangeModal,
    openMoveRangeModal: source.openMoveRangeModal,
    openKeepRangeModal: source.openKeepRangeModal,
    handleKeepOddPages: voidRun(source.handleKeepOddPages),
    handleKeepEvenPages: voidRun(source.handleKeepEvenPages),
    handleDeleteOddPages: voidRun(source.handleDeleteOddPages),
    handleDeleteEvenPages: voidRun(source.handleDeleteEvenPages),
    handleAddBlankPage: voidRun(source.handleAddBlankPage),
    handleAddBlankPageBefore: voidRun(source.handleAddBlankPageBefore),
    openInsertBlankPagesModal: source.openInsertBlankPagesModal,
    handleInsertBlankBetweenPages: voidRun(source.handleInsertBlankBetweenPages),
    handleInsertBlankBeforeOddPages: voidRun(source.handleInsertBlankBeforeOddPages),
    handleInsertBlankBeforeEvenPages: voidRun(source.handleInsertBlankBeforeEvenPages),
    handleInsertBlankAfterOddPages: voidRun(source.handleInsertBlankAfterOddPages),
    handleInsertBlankAfterEvenPages: voidRun(source.handleInsertBlankAfterEvenPages),
    handleMovePageToFirst: voidRun(source.handleMovePageToFirst),
    handleMovePageToLast: voidRun(source.handleMovePageToLast),
    handleMovePageUp: voidRun(source.handleMovePageUp),
    handleMovePageDown: voidRun(source.handleMovePageDown),
    openSwapPagesModal: source.openSwapPagesModal,
    handleReversePages: voidRun(source.handleReversePages),
    openReverseRangeModal: source.openReverseRangeModal,
    handleReverseOddPages: voidRun(source.handleReverseOddPages),
    handleReverseEvenPages: voidRun(source.handleReverseEvenPages),
    handleMoveOddPagesToStart: voidRun(source.handleMoveOddPagesToStart),
    handleMoveEvenPagesToStart: voidRun(source.handleMoveEvenPagesToStart),
    handleMoveOddPagesToEnd: voidRun(source.handleMoveOddPagesToEnd),
    handleMoveEvenPagesToEnd: voidRun(source.handleMoveEvenPagesToEnd),
    handleSplitOddEven: voidRun(source.handleSplitOddEven),
    handleDuplicateAllPages: voidRun(source.handleDuplicateAllPages),
    handleDuplicatePageToEnd: voidRun(source.handleDuplicatePageToEnd),
    handleDuplicateOddPages: voidRun(source.handleDuplicateOddPages),
    handleDuplicateEvenPages: voidRun(source.handleDuplicateEvenPages),
    handleDuplicateOddPagesBefore: voidRun(source.handleDuplicateOddPagesBefore),
    handleDuplicateEvenPagesBefore: voidRun(source.handleDuplicateEvenPagesBefore),
    handleDuplicateOddPagesToEnd: voidRun(source.handleDuplicateOddPagesToEnd),
    handleDuplicateEvenPagesToEnd: voidRun(source.handleDuplicateEvenPagesToEnd),
    handleDuplicateOddPagesToStart: voidRun(source.handleDuplicateOddPagesToStart),
    handleDuplicateEvenPagesToStart: voidRun(source.handleDuplicateEvenPagesToStart),
    openDeleteModal: source.openDeleteModal,
    openDeleteRangeModal: source.openDeleteRangeModal,
    openDeleteNthModal: source.openDeleteNthModal,
    openInsertModal: source.openInsertModal,
    openMergeModal: source.openMergeModal,
    openInterleaveModal: source.openInterleaveModal,
    openPrependModal: source.openPrependModal,
    openReplacePageModal: source.openReplacePageModal,
    openSplitModal: source.openSplitModal,
    openSplitAtModal: source.openSplitAtModal,
    openSplitEveryModal: source.openSplitEveryModal,
    openExtractModal: source.openExtractModal,
    openExtractOddModal: source.openExtractOddModal,
    openExtractEvenModal: source.openExtractEvenModal,
    setViewModePdf: source.setViewModePdf,
    toggleMarkdownView: source.toggleMarkdownView,
    handleOptimizePdf: source.handleOptimizePdf,
    openExportPngModal: source.openExportPngModal,
    openExportPagePdfModal: source.openExportPagePdfModal,
    openExportPagesPdfModal: source.openExportPagesPdfModal,
    openInsertImagePageModal: source.openInsertImagePageModal,
    openPageNumbersModal: source.openPageNumbersModal,
    openPageHeaderModal: source.openPageHeaderModal,
    openPageFooterModal: source.openPageFooterModal,
    openPageSizeModal: source.openPageSizeModal,
    openWatermarkModal: source.openWatermarkModal,
    openCropModal: source.openCropModal,
    openCropRangeModal: source.openCropRangeModal,
    handleCropOddPages: voidRun(source.handleCropOddPages),
    handleCropEvenPages: voidRun(source.handleCropEvenPages),
    openExpandMarginsModal: source.openExpandMarginsModal,
    openShrinkMarginsModal: source.openShrinkMarginsModal,
    openPageBorderModal: source.openPageBorderModal,
    openFlattenModal: source.openFlattenModal,
    handleFlattenAllAnnotations: voidRun(source.handleFlattenAllAnnotations),
    handleFlattenOddPages: voidRun(source.handleFlattenOddPages),
    handleFlattenEvenPages: voidRun(source.handleFlattenEvenPages),
    handleSortPagesBySize: voidSort(source.handleSortPagesBySize),
    handleSortOddPagesBySize: voidSort(source.handleSortOddPagesBySize),
    handleSortEvenPagesBySize: voidSort(source.handleSortEvenPagesBySize),
    handleSortPagesByRotation: voidSort(source.handleSortPagesByRotation),
    handleSortOddPagesByRotation: voidSort(source.handleSortOddPagesByRotation),
    handleSortEvenPagesByRotation: voidSort(source.handleSortEvenPagesByRotation),
    openMetadataModal: voidRun(source.openMetadataModal),
    handleSummarizePdf: source.handleSummarizePdf,
    openProtectModal: source.openProtectModal,
    openDecryptModal: source.openDecryptModal,
    openSignModal: source.openSignModal,
    toggleSignaturesPanel: source.toggleSignaturesPanel,
    toggleBookmarksPanel: source.toggleBookmarksPanel,
    toggleRedactMode: source.toggleRedactMode,
    toggleHighlightMode: source.toggleHighlightMode,
    toggleNoteMode: source.toggleNoteMode,
    toggleDrawMode: source.toggleDrawMode,
    toggleShapeMode: source.toggleShapeMode,
    toggleStampMode: source.toggleStampMode,
    toggleImageInsertMode: source.toggleImageInsertMode,
    toggleTextEditMode: source.toggleTextEditMode,
    toggleVectorEditMode: source.toggleVectorEditMode,
    openPageEditsModal: source.openPageEditsModal,
    toggleFormsPanel: source.toggleFormsPanel,
    openTesseractGuide: source.openTesseractGuide,
    openShortcutsHelp: source.openShortcutsHelp,
    openLicenses: source.openLicenses,
    openCredits: source.openCredits,
    openAbout: source.openAbout,
    openCommandPalette: source.openCommandPalette,
  };
}
