import { usePdfRecents } from './usePdfRecents';
import { usePdfDocument } from '../pdf/usePdfDocument';
import { useUndoHistory } from '../pdf/useUndoHistory';
import { usePdfOpen } from './usePdfOpen';
import { usePdfBrowser } from '../pdf/usePdfBrowser';
import { usePdfSearch } from '../pdf/usePdfSearch';
import { usePrintJobs } from '../pdf/usePrintJobs';
import { useClosePdf } from './usePdfLifecycle';
import type { useAppLifecycleLoaders } from './useAppLifecycleLoaders';

type LifecycleInput = import('./useAppLifecycleHooks').UseAppLifecycleHooksInput;
type Loaders = ReturnType<typeof useAppLifecycleLoaders>;

export type UseAppLifecycleDocumentInput = {
  input: LifecycleInput;
  loaders: Loaders;
};

export function useAppLifecycleDocument({ input, loaders }: UseAppLifecycleDocumentInput) {
  const { doc, modal, security, panels, annotation, refs, pageRanges, showToast, withLoading, filePathRef, cancelDrawing } = input;
  const {
    filePath,
    originalPath,
    setIsDirty,
    pageCount,
    currentPage,
    viewMode,
    setPageCount,
    setCurrentPage,
    setPageInput,
    setViewMode,
    setPdfRevision,
    setMarkdownRevision,
    setZoom,
    setMarkdownText,
    setMarkdownPath,
    setMarkdownOcrNotice,
    setFilePath,
    setOriginalPath,
  } = doc;

  const {
    openFilePath,
    setOpenFilePath,
    setRecentPdfs,
    lastBrowserDir,
    insertFilePath,
    setInsertFilePath,
    replaceSourcePath,
    setReplaceSourcePath,
    setReplaceSourcePageCount,
    setReplaceSourcePage,
    interleaveFilePath,
    setInterleaveFilePath,
    setInterleaveSourcePageCount,
    prependFilePath,
    setPrependFilePath,
    setPrependSourcePageCount,
    mergeFilePath,
    setMergeFilePath,
    setShowOpenModal,
    setShowDeleteModal,
  } = modal;

  const {
    pendingEncryptedPath,
    pdfPasswordDraft,
    setPendingEncryptedPath,
    setPdfPasswordDraft,
    setShowPasswordModal,
    setShowSignModal,
    setShowMetadataModal,
  } = security;

  const {
    setHighlightMode,
    setImageInsertMode,
    setFormAddMode,
    setImageSourcePath,
    setShowImageInsertModal,
    setShowAddFormFieldModal,
    setNewFormFieldName,
    setNewFormFieldKind,
    setNewFormFieldOptions,
    setNewFormRadioGroup,
    setNewFormRadioOption,
    setNewFormCheckboxChecked,
  } = annotation;

  const {
    setFormFields,
    setFormDrafts,
    setPdfBookmarks,
    setPdfSignatures,
    setSignatureVerification,
    setShowFormsPanel,
    setShowSignaturesPanel,
    setShowBookmarksPanel,
  } = panels;

  const { setPageSizes } = modal;
  const { interleaveRange, prependRange } = pageRanges;
  const { rememberBrowserDirectory } = loaders;

  const { rememberOpenedPdf } = usePdfRecents({ rememberBrowserDirectory, setRecentPdfs });

  const {
    imageSrc,
    thumbnails,
    annotations,
    setAnnotations,
    loadThumbnails,
    renderPage,
    goToPage,
    reloadOpenPdf,
    refreshAfterWorkingChange,
    revokeViewerAssets,
  } = usePdfDocument({
    filePath,
    pageCount,
    currentPage,
    viewMode,
    setPageCount,
    setCurrentPage,
    setPageInput,
    setViewMode,
    setPdfRevision,
    setMarkdownRevision,
    withLoading,
    loadPageEdits: loaders.loadPageEdits,
    loadPdfBookmarks: (path) => refs.loadPdfBookmarksRef.current(path),
    loadPageSizes: (path) => refs.loadPageSizesRef.current(path),
    cancelDrawing,
  });

  const {
    canUndo,
    canRedo,
    markPdfEdited,
    resetHistoryForOpen,
    markSaved,
    discardHistory,
    undo: undoHistory,
    redo: redoHistory,
  } = useUndoHistory({
    filePathRef,
    showToast,
    withLoading,
    onRestore: refreshAfterWorkingChange,
    setPdfRevision,
    setViewMode,
    setIsDirty,
  });

  const undo = () => undoHistory(filePath);
  const redo = () => redoHistory(filePath);

  const {
    loadPdfFromPath,
    openPdf,
    handleOpenPdfPath,
    handleOpenEncryptedPdf,
    handleOpenRecentPdf,
  } = usePdfOpen({
    filePath,
    originalPath,
    openFilePath,
    pendingEncryptedPath,
    pdfPasswordDraft,
    withLoading,
    resetHistoryForOpen,
    renderPage,
    loadThumbnails,
    loadFormFields: loaders.loadFormFields,
    rememberOpenedPdf,
    cancelDrawing,
    guardUnsaved: loaders.guardUnsaved,
    showToast,
    setOriginalPath,
    setFilePath,
    setViewMode,
    setMarkdownText,
    setMarkdownPath,
    setMarkdownOcrNotice,
    setPdfRevision,
    setMarkdownRevision,
    setPageCount,
    setCurrentPage,
    setZoom,
    setOpenFilePath,
    setShowOpenModal,
    setPendingEncryptedPath,
    setPdfPasswordDraft,
    setShowPasswordModal,
  });

  const browser = usePdfBrowser({
    lastBrowserDir,
    originalPath,
    openFilePath,
    insertFilePath,
    replaceSourcePath,
    interleaveFilePath,
    prependFilePath,
    mergeFilePath,
    withLoading,
    loadPdfFromPath,
    rememberBrowserDirectory,
    interleaveRange,
    prependRange,
    setOpenFilePath,
    setInsertFilePath,
    setReplaceSourcePath,
    setReplaceSourcePageCount,
    setReplaceSourcePage,
    setInterleaveFilePath,
    setInterleaveSourcePageCount,
    setPrependFilePath,
    setPrependSourcePageCount,
    setMergeFilePath,
    setShowOpenModal,
  });

  const search = usePdfSearch({
    filePath,
    withLoading,
    renderPage,
    setViewMode,
    setCurrentPage,
    setPageInput,
    showToast,
  });

  const { printPages, handlePrint, clearPrintPages } = usePrintJobs({ filePath, pageCount, withLoading });

  const { closePdf } = useClosePdf({
    filePath,
    discardHistory,
    cancelDrawing,
    revokeViewerAssets,
    clearPrintPages,
    showToast,
    setFilePath,
    setOriginalPath,
    setIsDirty,
    setPageCount,
    setCurrentPage,
    setPageInput,
    setZoom,
    setViewMode,
    setMarkdownText,
    setMarkdownPath,
    setMarkdownOcrNotice,
    setPdfRevision,
    setMarkdownRevision,
    setHighlightMode,
    setImageInsertMode,
    setFormAddMode,
    setImageSourcePath,
    setShowImageInsertModal,
    setShowFormsPanel,
    setShowSignaturesPanel,
    setShowBookmarksPanel,
    setPdfBookmarks,
    setPageSizes,
    setPdfSignatures,
    setSignatureVerification,
    setShowSignModal,
    setShowMetadataModal,
    setFormFields,
    setFormDrafts,
    setShowAddFormFieldModal,
    setNewFormFieldName,
    setNewFormFieldKind,
    setNewFormFieldOptions,
    setNewFormRadioGroup,
    setNewFormRadioOption,
    setNewFormCheckboxChecked,
    setShowDeleteModal,
  });

  return {
    imageSrc,
    thumbnails,
    annotations,
    setAnnotations,
    loadThumbnails,
    renderPage,
    goToPage,
    reloadOpenPdf,
    canUndo,
    canRedo,
    markPdfEdited,
    markSaved,
    undo,
    redo,
    loadPdfFromPath,
    openPdf,
    handleOpenPdfPath,
    handleOpenEncryptedPdf,
    handleOpenRecentPdf,
    browser,
    search,
    printPages,
    handlePrint,
    closePdf,
    rememberOpenedPdf,
  };
}
