import { usePanelLoaders } from './usePanelLoaders';
import { usePageEditsLoader } from './usePageEditsLoader';
import { useTesseractReminder } from './useTesseractReminder';
import { useRememberBrowserDirectory } from './useRememberBrowserDirectory';
import { useUnsavedGuard } from './useUnsavedGuard';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import { usePdfRecents } from './usePdfRecents';
import { usePdfDocument } from '../pdf/usePdfDocument';
import { useUndoHistory } from '../pdf/useUndoHistory';
import { usePdfOpen } from './usePdfOpen';
import { usePdfBrowser } from '../pdf/usePdfBrowser';
import { usePdfSearch } from '../pdf/usePdfSearch';
import { usePrintJobs } from '../pdf/usePrintJobs';
import { useClosePdf } from './usePdfLifecycle';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useSecurityFormState } from './useSecurityFormState';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppRefs } from './useAppRefs';
import type { useHelpChromeState } from './useHelpChromeState';
import type { useAppPageRanges } from './useAppPageRanges';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type SecurityState = ReturnType<typeof useSecurityFormState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type RefsState = ReturnType<typeof useAppRefs>;
type HelpState = ReturnType<typeof useHelpChromeState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;

export type UseAppLifecycleHooksInput = {
  doc: DocumentState;
  modal: ModalState;
  security: SecurityState;
  panels: PanelsState;
  annotation: AnnotationState;
  refs: RefsState;
  pageRanges: PageRangesState;
  ocrAvailable: boolean;
  tesseractReminderSource: HelpState['tesseractReminderSource'];
  setTesseractReminderSource: HelpState['setTesseractReminderSource'];
  tesseractDoNotRemind: boolean;
  setTesseractDoNotRemind: HelpState['setTesseractDoNotRemind'];
  setShowTesseractModal: HelpState['setShowTesseractModal'];
  showToast: (message: string, type?: 'success' | 'error') => void;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  isDirtyRef: DocumentState['isDirtyRef'];
  filePathRef: RefsState['filePathRef'];
  cancelDrawing: () => void;
};

export function useAppLifecycleHooks(input: UseAppLifecycleHooksInput) {
  const {
    doc,
    modal,
    security,
    panels,
    annotation,
    refs,
    pageRanges,
    ocrAvailable,
    tesseractReminderSource,
    setTesseractReminderSource,
    tesseractDoNotRemind,
    setTesseractDoNotRemind,
    setShowTesseractModal,
    showToast,
    withLoading,
    isDirtyRef,
    filePathRef,
    cancelDrawing,
  } = input;

  const {
    filePath,
    originalPath,
    isDirty,
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
    setFilePath,
    setOriginalPath,
    setZoom,
    setMarkdownText,
    setMarkdownPath,
    setMarkdownOcrNotice,
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
    setPageTextEdits,
    setPageVectorEdits,
  } = annotation;

  const { handleMarkdownViewRef, loadPdfBookmarksRef, loadPageSizesRef, handleSaveRef } = refs;
  const { interleaveRange, prependRange } = pageRanges;

  const { loadFormFields, loadPdfBookmarks, loadPdfSignatures, loadPageSizes } = usePanelLoaders({
    filePath,
    setFormFields,
    setFormDrafts,
    setPdfBookmarks,
    setPdfSignatures,
    setSignatureVerification,
    setPageSizes,
  });
  loadPdfBookmarksRef.current = (path) => { void loadPdfBookmarks(path); };
  loadPageSizesRef.current = (path) => { void loadPageSizes(path); };

  const { loadPageEdits } = usePageEditsLoader({ setPageTextEdits, setPageVectorEdits });

  const {
    shouldShowTesseractReminder,
    closeTesseractReminderModal,
    showLaunchTesseractReminder,
    openTesseractGuide,
  } = useTesseractReminder({
    ocrAvailable,
    tesseractReminderSource,
    setTesseractReminderSource,
    tesseractDoNotRemind,
    setTesseractDoNotRemind,
    setShowTesseractModal,
    handleMarkdownViewRef,
  });

  const rememberBrowserDirectory = useRememberBrowserDirectory({ setLastBrowserDir: modal.setLastBrowserDir });

  const {
    showUnsavedModal,
    setShowUnsavedModal,
    pendingNavRef,
    guardUnsaved,
    resolveUnsaved,
  } = useUnsavedGuard({
    isDirty,
    setIsDirty,
    onSave: () => handleSaveRef.current(),
  });

  useWindowCloseGuard({ isDirtyRef, pendingNavRef, setShowUnsavedModal });

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
    loadPageEdits,
    loadPdfBookmarks: (path) => loadPdfBookmarksRef.current(path),
    loadPageSizes: (path) => loadPageSizesRef.current(path),
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
    loadFormFields,
    rememberOpenedPdf,
    cancelDrawing,
    guardUnsaved,
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
    showToast,
    withLoading,
    loadFormFields,
    loadPdfBookmarks,
    loadPdfSignatures,
    loadPageSizes,
    shouldShowTesseractReminder,
    closeTesseractReminderModal,
    showLaunchTesseractReminder,
    openTesseractGuide,
    rememberBrowserDirectory,
    rememberOpenedPdf,
    showUnsavedModal,
    resolveUnsaved,
    guardUnsaved,
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
  };
}
