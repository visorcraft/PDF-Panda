import { usePdfRecents } from './usePdfRecents';
import { usePdfDocument } from '../pdf/usePdfDocument';
import { useUndoHistory } from '../pdf/useUndoHistory';
import { usePdfOpen } from './usePdfOpen';
import type { UseAppLifecycleDocumentInput } from './useAppLifecycleDocument';

export function useAppLifecycleOpen({ input, loaders }: UseAppLifecycleDocumentInput) {
  const { doc, modal, security, refs, showToast, withLoading, filePathRef, cancelDrawing } = input;
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

  const { openFilePath, setOpenFilePath, setRecentPdfs, setShowOpenModal } = modal;
  const {
    pendingEncryptedPath,
    pdfPasswordDraft,
    setPendingEncryptedPath,
    setPdfPasswordDraft,
    setShowPasswordModal,
  } = security;

  const { rememberOpenedPdf } = usePdfRecents({ rememberBrowserDirectory: loaders.rememberBrowserDirectory, setRecentPdfs });

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
    rememberOpenedPdf,
    revokeViewerAssets,
    discardHistory,
  };
}
