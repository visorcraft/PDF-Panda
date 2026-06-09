import { AppShell } from './chrome/AppShell';
import { buildAppShellRenderInput } from './chrome/buildAppShellRenderInput';
import { buildAppModalCtxInput } from './modals/buildAppModalCtxInput';
import { useAppDocumentState } from './app/useAppDocumentState';
import { useAppModalState } from './app/useAppModalState';
import { useSecurityFormState } from './app/useSecurityFormState';
import { useDocumentPanelsState } from './app/useDocumentPanelsState';
import { useAnnotationDraftState } from './app/useAnnotationDraftState';
import { useHelpChromeState } from './app/useHelpChromeState';
import { useAppRefs } from './app/useAppRefs';
import { useDrawingGesture } from './viewer/useDrawingGesture';
import { useAppLoading } from './app/useAppLoading';
import { useAppPageRanges } from './app/useAppPageRanges';
import { useSourcePdfPageCounts } from './app/useSourcePdfPageCounts';
import { useAppLifecycleHooks } from './app/useAppLifecycleHooks';
import { useAppViewerWorkflow } from './app/useAppViewerWorkflow';
import { useAppPdfActionsBinding } from './app/useAppPdfActionsBinding';
import { useAppChromeBindings } from './app/useAppChromeBindings';
import { useAppSetupHooks } from './app/useAppSetupHooks';

function App() {
  const doc = useAppDocumentState();
  const modal = useAppModalState();
  const security = useSecurityFormState();
  const panels = useDocumentPanelsState();
  const help = useHelpChromeState();
  const annotation = useAnnotationDraftState();
  const drawingGesture = useDrawingGesture();
  const refs = useAppRefs();
  const { showToast, withLoading } = useAppLoading({ setToast: doc.setToast, setLoading: doc.setLoading });
  const pageRanges = useAppPageRanges({ pageCount: doc.pageCount, currentPage: doc.currentPage, showToast });

  useSourcePdfPageCounts({
    insertFilePath: modal.insertFilePath,
    mergeFilePath: modal.mergeFilePath,
    insertRange: pageRanges.insertRange,
    mergeRange: pageRanges.mergeRange,
    setInsertSourcePageCount: modal.setInsertSourcePageCount,
    setMergeSourcePageCount: modal.setMergeSourcePageCount,
  });

  const lifecycle = useAppLifecycleHooks({
    doc,
    modal,
    security,
    panels,
    annotation,
    refs: {
      filePathRef: refs.filePathRef,
      handleMarkdownViewRef: refs.handleMarkdownViewRef,
      loadPdfBookmarksRef: refs.loadPdfBookmarksRef,
      loadPageSizesRef: refs.loadPageSizesRef,
      cancelDrawingRef: refs.cancelDrawingRef,
      keyboardActionsRef: refs.keyboardActionsRef,
      imgRef: refs.imgRef,
      handleSaveRef: refs.handleSaveRef,
    },
    pageRanges,
    ocrAvailable: !!doc.ocrAvailable,
    tesseractReminderSource: help.tesseractReminderSource,
    setTesseractReminderSource: help.setTesseractReminderSource,
    tesseractDoNotRemind: help.tesseractDoNotRemind,
    setTesseractDoNotRemind: help.setTesseractDoNotRemind,
    setShowTesseractModal: help.setShowTesseractModal,
    showToast,
    withLoading,
    isDirtyRef: doc.isDirtyRef,
    filePathRef: refs.filePathRef,
    cancelDrawing: () => refs.cancelDrawingRef.current(),
  });

  const {
    loadFormFields,
    loadPdfBookmarks,
    loadPdfSignatures,
    loadPageSizes,
    showLaunchTesseractReminder,
    openTesseractGuide,
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
    canUndo,
    canRedo,
    markPdfEdited,
    markSaved,
    undo,
    redo,
    openPdf,
    browser,
    search,
    printPages,
    handlePrint,
    closePdf,
  } = lifecycle;

  const {
    handleOpenPdfPath,
    handleOpenEncryptedPdf,
    handleOpenRecentPdf,
  } = lifecycle;
  const {
    showBrowserModal,
    setShowBrowserModal,
    browserListing,
    browserPathInput,
    setBrowserPathInput,
    loadPdfBrowser,
    openPdfBrowser,
    commitBrowserPath,
    handleBrowserEntryClick,
  } = browser;
  const { showSearchModal, closeSearchModal, openSearchModal } = search;

  const { windowTitle } = useAppSetupHooks({
    doc,
    modal,
    help,
    refs: { filePathRef: refs.filePathRef },
    onShowTesseractReminder: showLaunchTesseractReminder,
  });

  const viewerWorkflow = useAppViewerWorkflow({
    pageCount: doc.pageCount,
    viewMode: doc.viewMode,
    currentPage: doc.currentPage,
    filePath: doc.filePath,
    draggedIndex: doc.draggedIndex,
    zoom: doc.zoom,
    zoomInput: doc.zoomInput,
    pageInput: doc.pageInput,
    setDraggedIndex: doc.setDraggedIndex,
    setCurrentPage: doc.setCurrentPage,
    setZoom: doc.setZoom,
    setZoomInput: doc.setZoomInput,
    setPageInput: doc.setPageInput,
    goToPage,
    withLoading,
    markPdfEdited,
    loadThumbnails,
    renderPage,
  });

  const pdfActions = useAppPdfActionsBinding({
    doc,
    modal,
    security,
    panels,
    annotation,
    drawing: drawingGesture,
    pageRanges,
    refs: {
      cancelDrawingRef: refs.cancelDrawingRef,
      handleSaveRef: refs.handleSaveRef,
      handleMarkdownViewRef: refs.handleMarkdownViewRef,
      imgRef: refs.imgRef,
    },
    help,
    runtime: {
      loadFormFields,
      loadPageSizes,
      loadPdfBookmarks,
      loadPdfFromPath: lifecycle.loadPdfFromPath,
      loadPdfSignatures,
      loadThumbnails,
      markPdfEdited,
      markSaved,
      reloadOpenPdf: lifecycle.reloadOpenPdf,
      rememberBrowserDirectory: lifecycle.rememberBrowserDirectory,
      rememberOpenedPdf: lifecycle.rememberOpenedPdf,
      renderPage,
      setAnnotations,
      shouldShowTesseractReminder: lifecycle.shouldShowTesseractReminder,
      showToast,
      withLoading,
    },
  });

  const { appMenus, modeToolbarExtras } = useAppChromeBindings({
    doc,
    modal,
    security,
    panels,
    annotation,
    help,
    refs: { keyboardActionsRef: refs.keyboardActionsRef },
    pdfActions,
    history: { canUndo, canRedo, undo, redo },
    chrome: {
      guardUnsaved,
      closePdf,
      openPdf,
      goToPage,
      handlePrint,
      openSearchModal,
      openTesseractGuide,
    },
    zoom: {
      zoomIn: viewerWorkflow.zoomIn,
      zoomOut: viewerWorkflow.zoomOut,
      resetZoom: viewerWorkflow.resetZoom,
    },
    unsaved: { showUnsavedModal, resolveUnsaved },
    browser: { showBrowserModal, setShowBrowserModal },
    search: { showSearchModal, closeSearchModal },
  });

  const modalCtx = buildAppModalCtxInput({
    modal,
    security,
    annotation,
    pageRanges,
    doc: { currentPage: doc.currentPage, pageCount: doc.pageCount },
    browser: {
      showBrowserModal,
      setShowBrowserModal,
      browserListing,
      browserPathInput,
      setBrowserPathInput,
      loadPdfBrowser,
      openPdfBrowser,
      commitBrowserPath,
      handleBrowserEntryClick,
    },
    search: {
      showSearchModal,
      searchQuery: search.searchQuery,
      setSearchQuery: search.setSearchQuery,
      searchMatchCase: search.searchMatchCase,
      setSearchMatchCase: search.setSearchMatchCase,
      searchWholeWord: search.searchWholeWord,
      setSearchWholeWord: search.setSearchWholeWord,
      searchResults: search.searchResults,
      searchResultIndex: search.searchResultIndex,
      searchInputRef: search.searchInputRef,
      closeSearchModal,
      runPdfSearch: search.runPdfSearch,
      stepSearchMatch: search.stepSearchMatch,
    },
    unsaved: { showUnsavedModal, resolveUnsaved },
    tesseract: { closeTesseractReminderModal: lifecycle.closeTesseractReminderModal },
    help,
    lifecycle: { handleOpenPdfPath, handleOpenEncryptedPdf, handleOpenRecentPdf, loadPdfBrowser, openPdfBrowser },
    runtime: { showToast },
    pdfActions,
  });

  const shell = buildAppShellRenderInput({
    doc,
    modal,
    panels,
    annotation,
    drawing: drawingGesture,
    help,
    refs: { imgRef: refs.imgRef },
    pdfActions,
    windowTitle,
    appMenus,
    modeExtras: modeToolbarExtras,
    modalCtx,
    printPages,
    viewer: {
      thumbnails,
      imageSrc,
      annotations,
      scrollRef: viewerWorkflow.scrollRef,
      handleWheel: viewerWorkflow.handleWheel,
      handleImageLoad: viewerWorkflow.handleImageLoad,
      handleDragStart: viewerWorkflow.handleDragStart,
      handleDragOver: viewerWorkflow.handleDragOver,
      handleDrop: viewerWorkflow.handleDrop,
      goToPage,
      openPdf,
      loadPdfBookmarks,
      loadPdfSignatures,
      activeSearchRect: search.activeSearchRect,
      commitPage: viewerWorkflow.commitPage,
      commitZoom: viewerWorkflow.commitZoom,
      zoomIn: viewerWorkflow.zoomIn,
      zoomOut: viewerWorkflow.zoomOut,
      resetZoom: viewerWorkflow.resetZoom,
    },
  });

  return <AppShell {...shell} />;
}

export default App;
