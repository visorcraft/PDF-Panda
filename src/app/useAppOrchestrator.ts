import { useAppDocumentState } from './useAppDocumentState';
import { useAppModalState } from './useAppModalState';
import { useSecurityFormState } from './useSecurityFormState';
import { useDocumentPanelsState } from './useDocumentPanelsState';
import { useAnnotationDraftState } from './useAnnotationDraftState';
import { useHelpChromeState } from './useHelpChromeState';
import { useAppRefs } from './useAppRefs';
import { useDrawingGesture } from '../viewer/useDrawingGesture';
import { useAppLoading } from './useAppLoading';
import { useAppPageRanges } from './useAppPageRanges';
import { useAppLifecycleHooks } from './useAppLifecycleHooks';
import { useAppLifecycleSlices } from './useAppLifecycleSlices';
import { useAppViewerWorkflow } from './useAppViewerWorkflow';
import { useAppPdfActionsBinding } from './useAppPdfActionsBinding';
import { useAppChromeBindings } from './useAppChromeBindings';
import { useAppSetupHooks } from './useAppSetupHooks';
import { useAppModalCtxBinding } from './useAppModalCtxBinding';
import { useAppShellBinding } from './useAppShellBinding';

export function useAppOrchestrator() {
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

  const slices = useAppLifecycleSlices(lifecycle);
  const { loaders, history, unsaved, browser, search, chrome, tesseract } = slices;

  const { windowTitle } = useAppSetupHooks({
    doc,
    modal,
    help,
    pageRanges,
    refs: { filePathRef: refs.filePathRef },
    onShowTesseractReminder: tesseract.showLaunchTesseractReminder,
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
    goToPage: slices.viewer.goToPage,
    withLoading,
    markPdfEdited: history.markPdfEdited,
    loadThumbnails: loaders.loadThumbnails,
    renderPage: loaders.renderPage,
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
      loadFormFields: loaders.loadFormFields,
      loadPageSizes: loaders.loadPageSizes,
      loadPdfBookmarks: loaders.loadPdfBookmarks,
      loadPdfFromPath: lifecycle.loadPdfFromPath,
      loadPdfSignatures: loaders.loadPdfSignatures,
      loadThumbnails: loaders.loadThumbnails,
      markPdfEdited: history.markPdfEdited,
      markSaved: history.markSaved,
      reloadOpenPdf: lifecycle.reloadOpenPdf,
      rememberBrowserDirectory: lifecycle.rememberBrowserDirectory,
      rememberOpenedPdf: lifecycle.rememberOpenedPdf,
      renderPage: loaders.renderPage,
      setAnnotations: slices.viewer.setAnnotations,
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
    history,
    chrome: {
      guardUnsaved: unsaved.guardUnsaved,
      closePdf: chrome.closePdf,
      openPdf: slices.viewer.openPdf,
      goToPage: slices.viewer.goToPage,
      handlePrint: chrome.handlePrint,
      openSearchModal: search.openSearchModal,
      openTesseractGuide: tesseract.openTesseractGuide,
    },
    zoom: {
      zoomIn: viewerWorkflow.zoomIn,
      zoomOut: viewerWorkflow.zoomOut,
      resetZoom: viewerWorkflow.resetZoom,
    },
    unsaved,
    browser: { showBrowserModal: browser.showBrowserModal, setShowBrowserModal: browser.setShowBrowserModal },
    search: { showSearchModal: search.showSearchModal, closeSearchModal: search.closeSearchModal },
  });

  const modalCtx = useAppModalCtxBinding({
    modal,
    security,
    annotation,
    pageRanges,
    help,
    doc: { currentPage: doc.currentPage, pageCount: doc.pageCount },
    slices,
    pdfActions,
    showToast,
  });

  return useAppShellBinding({
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
    modeToolbarExtras,
    modalCtx,
    slices,
    viewerWorkflow,
  });
}
