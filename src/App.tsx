import { AppShell } from './chrome/AppShell';
import { buildAppMenuInput } from './menu/buildAppMenuInput';
import { useAppBootstrap } from './app/useAppBootstrap';
import { buildAppModalCtxInput } from './modals/buildAppModalCtxInput';
import { buildAppShellSource } from './chrome/buildAppShellSource';
import { buildAppShellChromeInput } from './chrome/buildAppShellChromeInput';
import { buildAppShellViewerInput } from './viewer/buildAppShellViewerInput';
import { useAppModalState } from './app/useAppModalState';
import { useDocumentPanelsState } from './app/useDocumentPanelsState';
import { useSecurityFormState } from './app/useSecurityFormState';
import { useAnnotationDraftState } from './app/useAnnotationDraftState';
import { useHelpChromeState } from './app/useHelpChromeState';
import { useModalDismiss } from './app/useModalDismiss';
import { buildModalDismissInput } from './app/buildModalDismissInput';
import { useAppKeyboardBinding } from './app/useAppKeyboardBinding';
import { useAppRefs } from './app/useAppRefs';
import { useAppPdfActions } from './app/useAppPdfActions';
import { buildAppPdfActionsInput } from './app/buildAppPdfActionsInput';
import { useAppDocumentState } from './app/useAppDocumentState';
import { useDrawingGesture } from './viewer/useDrawingGesture';
import { useSourcePdfPageCounts } from './app/useSourcePdfPageCounts';
import { useWindowTitle } from './app/useWindowTitle';
import { usePageZoomInputSync } from './app/usePageZoomInputSync';
import { useAppLoading } from './app/useAppLoading';
import { useAppPageRanges } from './app/useAppPageRanges';
import { buildModeToolbarExtras } from './viewer/buildModeToolbarExtras';
import { buildAppKeyboardSource } from './app/buildAppKeyboardSource';
import { useAppViewerWorkflow } from './app/useAppViewerWorkflow';
import { useAppLifecycleHooks } from './app/useAppLifecycleHooks';
function App() {
  const doc = useAppDocumentState();
  const modal = useAppModalState();

  const security = useSecurityFormState();

  const panels = useDocumentPanelsState();

  const {
    filePathRef,
    handleMarkdownViewRef,
    loadPdfBookmarksRef,
    loadPageSizesRef,
    cancelDrawingRef,
    keyboardActionsRef,
    imgRef,
    handleSaveRef,
  } = useAppRefs();
  const {
    showCommandPalette, setShowCommandPalette,
    showShortcutsHelp, setShowShortcutsHelp,
    showLicenses, setShowLicenses,
    showCredits, setShowCredits,
    showAbout, setShowAbout,
    showTesseractModal, setShowTesseractModal,
    tesseractInstallGuide, setTesseractInstallGuide,
    tesseractDoNotRemind, setTesseractDoNotRemind,
    tesseractReminderSource, setTesseractReminderSource,
  } = useHelpChromeState();

  const annotation = useAnnotationDraftState();
  const drawingGesture = useDrawingGesture();
  const { highlightStart, highlightRect, inkDraft, shapeLineEnd, drawing, cancelDrawing } = drawingGesture;
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
    refs: { filePathRef, handleMarkdownViewRef, loadPdfBookmarksRef, loadPageSizesRef, cancelDrawingRef, keyboardActionsRef, imgRef, handleSaveRef },
    pageRanges,
    ocrAvailable: !!doc.ocrAvailable,
    tesseractReminderSource,
    setTesseractReminderSource,
    tesseractDoNotRemind,
    setTesseractDoNotRemind,
    setShowTesseractModal,
    showToast,
    withLoading,
    isDirtyRef: doc.isDirtyRef,
    filePathRef,
    cancelDrawing,
  });
  const {
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
  const {
    showSearchModal,
    searchQuery,
    setSearchQuery,
    searchMatchCase,
    setSearchMatchCase,
    searchWholeWord,
    setSearchWholeWord,
    searchResults,
    searchResultIndex,
    activeSearchRect,
    searchInputRef,
    openSearchModal,
    closeSearchModal,
    runPdfSearch,
    stepSearchMatch,
  } = search;

  useAppBootstrap({
    onNativeDialogs: modal.setNativeDialogs,
    onOcrAvailable: doc.setOcrAvailable,
    onTesseractInstallGuide: setTesseractInstallGuide,
    onShowTesseractReminder: showLaunchTesseractReminder,
  });

  const { windowTitle } = useWindowTitle({ filePath: doc.filePath, originalPath: doc.originalPath, isDirty: doc.isDirty, isDirtyRef: doc.isDirtyRef, filePathRef });

  usePageZoomInputSync({ currentPage: doc.currentPage, setPageInput: doc.setPageInput, zoom: doc.zoom, setZoomInput: doc.setZoomInput });

  const {
    scrollRef,
    handleWheel,
    handleImageLoad,
    handleDragStart,
    handleDragOver,
    handleDrop,
    zoomIn,
    zoomOut,
    resetZoom,
    commitZoom,
    commitPage,
  } = useAppViewerWorkflow({
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

  const pdfActions = useAppPdfActions(buildAppPdfActionsInput({
    modal,
    security,
    panels,
    annotation,
    document: doc,
    drawing: drawingGesture,
    pageRanges,
    refs: { cancelDrawingRef, handleSaveRef, handleMarkdownViewRef, imgRef },
    runtime: {
      loadFormFields,
      loadPageSizes,
      loadPdfBookmarks,
      loadPdfFromPath,
      loadPdfSignatures,
      loadThumbnails,
      markPdfEdited,
      markSaved,
      reloadOpenPdf,
      rememberBrowserDirectory,
      rememberOpenedPdf,
      renderPage,
      setAnnotations,
      shouldShowTesseractReminder,
      showToast,
      withLoading,
      setShowTesseractModal,
      setTesseractReminderSource,
    },
  }));


  const { dismissModals, anyModalOpen } = useModalDismiss(buildModalDismissInput({
    modal,
    security,
    annotation,
    help: { showCommandPalette, setShowCommandPalette, showShortcutsHelp, setShowShortcutsHelp, showLicenses, setShowLicenses, showCredits, setShowCredits, showAbout, setShowAbout, showTesseractModal, setShowTesseractModal, tesseractInstallGuide, setTesseractInstallGuide, tesseractDoNotRemind, setTesseractDoNotRemind, tesseractReminderSource, setTesseractReminderSource },
    unsaved: { showUnsavedModal, resolveUnsaved },
    browser: { showBrowserModal, setShowBrowserModal },
    search: { showSearchModal, closeSearchModal },
  }));

  useAppKeyboardBinding(keyboardActionsRef, buildAppKeyboardSource({
    doc: { isDirty: doc.isDirty, filePath: doc.filePath, pageCount: doc.pageCount, currentPage: doc.currentPage, viewMode: doc.viewMode },
    annotation: { noteMode: annotation.noteMode, drawMode: annotation.drawMode, shapeMode: annotation.shapeMode, stampMode: annotation.stampMode, redactMode: annotation.redactMode, imageInsertMode: annotation.imageInsertMode, textEditMode: annotation.textEditMode, vectorEditMode: annotation.vectorEditMode, formAddMode: annotation.formAddMode, highlightMode: annotation.highlightMode },
    history: { canUndo, canRedo, undo, redo },
    chrome: { anyModalOpen, dismissModals, guardUnsaved, closePdf, openPdf, setShowCommandPalette, goToPage, handlePrint, openSearchModal },
    zoom: { zoomIn, zoomOut, resetZoom },
    pdfActions,
  }));

  const appMenus = buildAppMenuInput({
    doc: { filePath: doc.filePath, isDirty: doc.isDirty, pageCount: doc.pageCount, currentPage: doc.currentPage, viewMode: doc.viewMode, ocrAvailable: !!doc.ocrAvailable },
    annotation: { highlightMode: annotation.highlightMode, noteMode: annotation.noteMode, drawMode: annotation.drawMode, shapeMode: annotation.shapeMode, stampMode: annotation.stampMode, redactMode: annotation.redactMode, imageInsertMode: annotation.imageInsertMode, textEditMode: annotation.textEditMode, vectorEditMode: annotation.vectorEditMode },
    panels: { showFormsPanel: panels.showFormsPanel, showBookmarksPanel: panels.showBookmarksPanel, showSignaturesPanel: panels.showSignaturesPanel },
    history: { canUndo, canRedo, undo, redo },
    chrome: { guardUnsaved, closePdf, setViewMode: doc.setViewMode, setShowBookmarksPanel: panels.setShowBookmarksPanel, setShowPageEditsModal: annotation.setShowPageEditsModal, openTesseractGuide, openPdf, handlePrint, openSearchModal },
    help: { setShowShortcutsHelp, setShowLicenses, setShowCredits, setShowAbout, setShowCommandPalette },
    pdfActions,
  });

  const modeToolbarExtras = buildModeToolbarExtras({
    filePath: doc.filePath,
    imageInsertMode: annotation.imageInsertMode,
    imageSourcePath: annotation.imageSourcePath,
    onOpenImageInsertModal: pdfActions.openImageInsertModal,
    stampMode: annotation.stampMode,
    stampKind: annotation.stampKind,
    stampPreset: annotation.stampPreset,
    onStampKindChange: annotation.setStampKind,
    onStampPresetChange: annotation.setStampPreset,
    shapeMode: annotation.shapeMode,
    shapeKind: annotation.shapeKind,
    onShapeKindChange: annotation.setShapeKind,
  });

  const modalCtx = buildAppModalCtxInput({
    modal,
    security,
    annotation,
    pageRanges,
    doc: { currentPage: doc.currentPage, pageCount: doc.pageCount },
    browser: { showBrowserModal, setShowBrowserModal, browserListing, browserPathInput, setBrowserPathInput, loadPdfBrowser, openPdfBrowser, commitBrowserPath, handleBrowserEntryClick },
    search: { showSearchModal, searchQuery, setSearchQuery, searchMatchCase, setSearchMatchCase, searchWholeWord, setSearchWholeWord, searchResults, searchResultIndex, searchInputRef, closeSearchModal, runPdfSearch, stepSearchMatch },
    unsaved: { showUnsavedModal, resolveUnsaved },
    tesseract: { closeTesseractReminderModal },
    help: { showCommandPalette, setShowCommandPalette, showShortcutsHelp, setShowShortcutsHelp, showLicenses, setShowLicenses, showCredits, setShowCredits, showAbout, setShowAbout, showTesseractModal, setShowTesseractModal, tesseractInstallGuide, setTesseractInstallGuide, tesseractDoNotRemind, setTesseractDoNotRemind, tesseractReminderSource, setTesseractReminderSource },
    lifecycle: { handleOpenPdfPath, handleOpenEncryptedPdf, handleOpenRecentPdf, loadPdfBrowser, openPdfBrowser },
    runtime: { showToast },
    pdfActions,
  });


  return (
    <AppShell
      {...buildAppShellSource({
        windowTitle,
        toast: doc.toast,
        loading: doc.loading,
        chrome: buildAppShellChromeInput({
          menus: appMenus,
          help: {
            showCommandPalette,
            showShortcutsHelp,
            showLicenses,
            showCredits,
            showAbout,
            setShowCommandPalette,
            setShowShortcutsHelp,
            setShowLicenses,
            setShowCredits,
            setShowAbout,
          },
          modeExtras: modeToolbarExtras,
          page: {
            pageCount: doc.pageCount,
            viewMode: doc.viewMode,
            currentPage: doc.currentPage,
            pageInput: doc.pageInput,
            pageSizes: modal.pageSizes,
            setPageInput: doc.setPageInput,
            commitPage,
            goToPage,
          },
          zoom: {
            zoom: doc.zoom,
            zoomInput: doc.zoomInput,
            setZoomInput: doc.setZoomInput,
            commitZoom,
            zoomIn,
            zoomOut,
            resetZoom,
          },
        }),
        viewer: buildAppShellViewerInput({
          document: { filePath: doc.filePath, viewMode: doc.viewMode, zoom: doc.zoom, markdownOcrNotice: doc.markdownOcrNotice, markdownPath: doc.markdownPath, markdownText: doc.markdownText },
          sidebar: {
            thumbnails,
            currentPage: doc.currentPage,
            draggedIndex: doc.draggedIndex,
            handleDragStart,
            handleDragOver,
            handleDrop,
            goToPage,
            showBookmarksPanel: panels.showBookmarksPanel,
            pdfBookmarks: panels.pdfBookmarks,
            openAddBookmarkModal: pdfActions.openAddBookmarkModal,
            openBookmarkAllModal: pdfActions.openBookmarkAllModal,
            handleClearAllBookmarks: pdfActions.handleClearAllBookmarks,
            loadPdfBookmarks,
            openRenameBookmarkModal: pdfActions.openRenameBookmarkModal,
            handleRemoveBookmark: pdfActions.handleRemoveBookmark,
            showSignaturesPanel: panels.showSignaturesPanel,
            pdfSignatures: panels.pdfSignatures,
            signatureVerification: panels.signatureVerification,
            loadPdfSignatures,
            showFormsPanel: panels.showFormsPanel,
            formFields: panels.formFields,
            formDrafts: panels.formDrafts,
            setFormDrafts: panels.setFormDrafts,
            openAddFormFieldModal: pdfActions.openAddFormFieldModal,
            applyFormField: pdfActions.applyFormField,
          },
          viewer: {
            scrollRef,
            handleWheel,
            openPdf,
            openMarkdownSaveAs: pdfActions.openMarkdownSaveAs,
            imageSrc,
            imgRef,
            handleImageLoad,
            activeSearchRect,
            annotations,
          },
          modes: {
            highlightMode: annotation.highlightMode,
            noteMode: annotation.noteMode,
            drawMode: annotation.drawMode,
            shapeMode: annotation.shapeMode,
            stampMode: annotation.stampMode,
            redactMode: annotation.redactMode,
            imageInsertMode: annotation.imageInsertMode,
            textEditMode: annotation.textEditMode,
            vectorEditMode: annotation.vectorEditMode,
            formAddMode: annotation.formAddMode,
            shapeKind: annotation.shapeKind,
            drawing,
            highlightStart,
            highlightRect,
            shapeLineEnd,
            inkDraft,
            pageTextEdits: annotation.pageTextEdits,
            pageVectorEdits: annotation.pageVectorEdits,
          },
          interaction: {
            handlePageClick: pdfActions.handlePageClick,
            handleDrawMouseDown: pdfActions.handleDrawMouseDown,
            handlePageMouseMove: pdfActions.handlePageMouseMove,
            handleDrawMouseUp: pdfActions.handleDrawMouseUp,
            removeHighlight: pdfActions.removeHighlight,
            removeRedaction: pdfActions.removeRedaction,
            removeStamp: pdfActions.removeStamp,
            removeShape: pdfActions.removeShape,
            removeInkStroke: pdfActions.removeInkStroke,
            removeTextNote: pdfActions.removeTextNote,
          },
        }),
        modalCtx,
        printPages,
      })}
    />
  );
}

export default App;
