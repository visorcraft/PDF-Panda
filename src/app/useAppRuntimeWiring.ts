import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppPdfActionsBinding } from './useAppPdfActionsBinding';
import { useAppChromeBindings } from './useAppChromeBindings';
import { useAppModalCtxBinding } from './useAppModalCtxBinding';
import { useAppShellBinding } from './useAppShellBinding';
import { useDocumentTabActions } from './useDocumentTabActions';
import { isTauriRuntime } from './tauriRuntime';
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
    persistence,
    appearance,
    shortcutBindings: shortcutBindingsState,
    surface,
  } = bootstrap;

  const { loaders, history, unsaved, browser, search, chrome, tesseract } = slices;

  const tabActions = useDocumentTabActions({
    doc,
    modal,
    security,
    panels,
    annotation,
    cancelDrawing: () => refs.cancelDrawingRef.current(),
    showToast,
    guardUnsavedForSession: (sessionId, action) => {
      const session = doc.sessions.find((s) => s.id === sessionId);
      if (sessionId !== doc.activeId) doc.setActiveSession(sessionId);
      unsaved.guardUnsaved(action, session?.isDirty);
    },
    discardHistory: lifecycle.discardHistory,
    clearModesOnTabSwitch: () => {
      annotation.setHighlightMode(false);
      annotation.setNoteMode(false);
      annotation.setDrawMode(false);
      annotation.setShapeMode(false);
      annotation.setStampMode(false);
      annotation.setRedactMode(false);
      annotation.setImageInsertMode(false);
      annotation.setTextEditMode(false);
      annotation.setEditTextRunMode(false);
      annotation.setVectorEditMode(false);
      annotation.setFormAddMode(false);
      annotation.setShowNoteModal(false);
      annotation.setPendingNotePos(null);
    },
    renderPage: loaders.renderPage,
    loadThumbnails: loaders.loadThumbnails,
    loadFormFields: loaders.loadFormFields,
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
      openTesseractGuide: tesseract.openTesseractGuide,
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
    history: { ...history, canUndo: doc.canUndo, canRedo: doc.canRedo },
    chrome: {
      guardUnsaved: unsaved.guardUnsaved,
      closePdf: tabActions.requestCloseActiveTab,
      openPdf: slices.viewer.openPdf,
      goToPage: viewerWorkflow.goToPage,
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
    appearance,
    shortcutBindings: shortcutBindingsState.bindings,
    surface,
  });

  const modalCtx = useAppModalCtxBinding({
    modal,
    security,
    annotation,
    pageRanges,
    help,
    doc: { currentPage: doc.currentPage, pageCount: doc.pageCount, ocrAvailable: doc.ocrAvailable },
    slices,
    pdfActions,
    showToast,
  });

  const openPathPendingRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    listen<string[]>('open-path', (event) => {
      openPathPendingRef.current = true;
      for (const path of event.payload) {
        void lifecycle.loadPdfFromPath(path);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: stable option object / destructured deps
  }, [lifecycle.loadPdfFromPath]);

  useEffect(() => {
    if (persistence?.restoreSessions) {
      void persistence.restoreSessions(() => openPathPendingRef.current).then(() => {
        // If an open-path arrived during restore, it already focused its tab;
        // do not override with the restored active index.
        if (openPathPendingRef.current) {
          openPathPendingRef.current = false;
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: stable option object / destructured deps
  }, []);

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
    surface,
    onSelectTab: tabActions.selectTab,
    onCloseTab: tabActions.requestCloseTab,
    shortcuts: shortcutBindingsState,
    showToast,
    appearance,
  });
}
