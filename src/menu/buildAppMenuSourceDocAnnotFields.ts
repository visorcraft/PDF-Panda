import type { AppMenuContextSource } from './buildAppMenuContext';
import type { BuildAppMenuSourceInput } from './buildAppMenuSource';

export function menuSourceDocAnnotFields(input: BuildAppMenuSourceInput): Pick<
  AppMenuContextSource,
  | 'hasPdf'
  | 'isDirty'
  | 'canUndo'
  | 'canRedo'
  | 'pageCount'
  | 'currentPage'
  | 'viewMode'
  | 'highlightMode'
  | 'noteMode'
  | 'drawMode'
  | 'shapeMode'
  | 'stampMode'
  | 'redactMode'
  | 'imageInsertMode'
  | 'textEditMode'
  | 'vectorEditMode'
  | 'showFormsPanel'
  | 'showBookmarksPanel'
  | 'showSignaturesPanel'
  | 'tesseractInstalled'
  | 'openPdf'
  | 'handleSave'
  | 'openSaveAs'
  | 'requestClosePdf'
  | 'undo'
  | 'redo'
  | 'handlePrint'
  | 'openSearchModal'
  | 'setViewModePdf'
  | 'toggleMarkdownView'
  | 'handleOptimizePdf'
  | 'openExportPngModal'
  | 'openExportPagePdfModal'
  | 'openExportPagesPdfModal'
  | 'openInsertImagePageModal'
  | 'openPageNumbersModal'
  | 'openPageHeaderModal'
  | 'openPageFooterModal'
  | 'openPageSizeModal'
  | 'openWatermarkModal'
  | 'openCropModal'
  | 'openCropRangeModal'
  | 'handleCropOddPages'
  | 'handleCropEvenPages'
  | 'openExpandMarginsModal'
  | 'openShrinkMarginsModal'
  | 'openPageBorderModal'
  | 'openFlattenModal'
  | 'handleFlattenAllAnnotations'
  | 'handleFlattenOddPages'
  | 'handleFlattenEvenPages'
  | 'openMetadataModal'
  | 'handleSummarizePdf'
  | 'openProtectModal'
  | 'openDecryptModal'
  | 'openSignModal'
  | 'toggleSignaturesPanel'
  | 'toggleBookmarksPanel'
  | 'toggleRedactMode'
  | 'toggleHighlightMode'
  | 'toggleNoteMode'
  | 'toggleDrawMode'
  | 'toggleShapeMode'
  | 'toggleStampMode'
  | 'toggleImageInsertMode'
  | 'toggleTextEditMode'
  | 'toggleVectorEditMode'
  | 'openPageEditsModal'
  | 'toggleFormsPanel'
  | 'openTesseractGuide'
  | 'openShortcutsHelp'
  | 'openLicenses'
  | 'openCredits'
  | 'openAbout'
  | 'openCommandPalette'
> {
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
