import { useAppPdfActionsBinding } from './useAppPdfActionsBinding';
import { useAppChromeBindings } from './useAppChromeBindings';
import { useAppModalCtxBinding } from './useAppModalCtxBinding';
import { useAppShellBinding } from './useAppShellBinding';
import type { useAppStateBootstrap } from './useAppStateBootstrap';

type Bootstrap = ReturnType<typeof useAppStateBootstrap>;

export function useAppRuntimeWiring(bootstrap: Bootstrap) {
  const {
    doc,
    modal,
    security,
    panels,
    annotation,
    drawingGesture,
    refs,
    pageRanges,
    help,
    showToast,
    withLoading,
    lifecycle,
    slices,
    windowTitle,
    viewerWorkflow,
  } = bootstrap;

  const { loaders, history, unsaved, browser, search, chrome, tesseract } = slices;

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
