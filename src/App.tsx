import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppShell } from './chrome/AppShell';
import { buildAppMenus } from './menu/buildAppMenus';
import { buildAppMenuContext } from './menu/buildAppMenuContext';
import { useAppBootstrap } from './app/useAppBootstrap';
import { useStructuralEdit } from './pdf/useStructuralEdit';
import { usePdfSearch } from './pdf/usePdfSearch';
import { usePdfBrowser } from './pdf/usePdfBrowser';
import { usePrintJobs } from './pdf/usePrintJobs';
import { usePageRange, usePageRangePair } from './pageRange/usePageRange';
import { type ImageExportFormat } from './pdf/imageExportCommands';
import { useUndoHistory } from './pdf/useUndoHistory';
import { usePdfDocument } from './pdf/usePdfDocument';
import { type FormFieldKind } from './modals/AddFormFieldModal';
import { type PageSizePreset } from './modals/PageSizeModal';
import { type TesseractInstallGuide } from './modals/TesseractReminderModal';
import { buildAppModalsContext } from './modals/appModalsContext';
import { buildViewerContext } from './viewer/buildViewerContext';
import { buildChromeContext } from './chrome/buildChromeContext';
import { useUnsavedGuard } from './app/useUnsavedGuard';
import { useModalDismiss } from './app/useModalDismiss';
import { useAppKeyboard, type AppKeyboardActions } from './app/useAppKeyboard';
import { usePanelLoaders } from './app/usePanelLoaders';
import { useClosePdf } from './app/usePdfLifecycle';
import { usePdfRecents } from './app/usePdfRecents';
import { usePdfOpen } from './app/usePdfOpen';
import { useThumbnailReorder } from './app/useThumbnailReorder';
import { useAnnotationModes } from './app/useAnnotationModes';
import { useMarkdownFlow } from './app/useMarkdownFlow';
import { useNativeFilePickers } from './app/useNativeFilePickers';
import { usePageTextEdits } from './app/usePageTextEdits';
import { usePageZoom } from './viewer/usePageZoom';
import { useDrawingGesture } from './viewer/useDrawingGesture';
import { usePageInteraction } from './viewer/usePageInteraction';
import { useImageExportActions } from './pdf/useImageExportActions';
import { usePdfModalOpeners } from './pdf/usePdfModalOpeners';
import { useSinglePageEditActions } from './pdf/useSinglePageEditActions';
import { useDuplicateRangeActions } from './pdf/useDuplicateRangeActions';
import { usePageHeaderFooterActions } from './pdf/usePageHeaderFooterActions';
import { useBookmarkActions } from './pdf/useBookmarkActions';
import { usePdfFileOpsActions } from './pdf/usePdfFileOpsActions';
import { useSecurityDocumentActions } from './pdf/useSecurityDocumentActions';
import { usePageDuplicateActions } from './pdf/usePageDuplicateActions';
import { useOddEvenPageActions } from './pdf/useOddEvenPageActions';
import { useSwapReplaceInterleaveActions } from './pdf/useSwapReplaceInterleaveActions';
import { usePageSizeActions } from './pdf/usePageSizeActions';
import { useExportPagesActions } from './pdf/useExportPagesActions';
import { useParityExportActions } from './pdf/useParityExportActions';
import { useRangeModalActions } from './pdf/useRangeModalActions';
import { useOddEvenExtendedActions } from './pdf/useOddEvenExtendedActions';
import { useSplitExtractPrependActions } from './pdf/useSplitExtractPrependActions';
import { usePageDecorActions } from './pdf/usePageDecorActions';
import { useSaveActions } from './pdf/useSaveActions';
import { ModeToolbarExtras } from './viewer/ModeToolbarExtras';
import { useWheelNavigation } from './viewer/useWheelNavigation';
import {
  DEFAULT_TESSERACT_GUIDE,
  RECENT_PDFS_KEY,
  LAST_BROWSER_DIR_KEY,
  type ShapeKind,
  type StampKind,
  STAMP_PRESETS,
} from './app/constants';
import {
  type FormFieldData,
  type MarkdownOcrNotice,
  type PageTextEdit,
  type PageVectorEdit,
  type PdfBookmarkEntry,
  type PdfPageSize,
  type PdfSignatureInfo,
  type PdfSignatureVerificationSummary,
  type PdfSummaryResult,
  type ViewMode,
} from './app/types';
import {
  directoryFromPath,
  dismissTesseractReminder,
  fileNameFromPath,
  isTesseractReminderDismissed,
  readStoredString,
  readStoredStringArray,
  writeStoredString,
} from './app/utils';

function App() {
  const [filePath, setFilePath] = useState<string>(''); // working-copy path; all backend ops target this
  const [originalPath, setOriginalPath] = useState<string>(''); // user's real file (display / recents / Save target)
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const isDirtyRef = useRef(false);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState<string>('');
  const [showMarkdownSaveAsModal, setShowMarkdownSaveAsModal] = useState(false);
  const [showProtectModal, setShowProtectModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingEncryptedPath, setPendingEncryptedPath] = useState('');
  const [protectUserPassword, setProtectUserPassword] = useState('');
  const [protectUserPasswordConfirm, setProtectUserPasswordConfirm] = useState('');
  const [protectOwnerPassword, setProtectOwnerPassword] = useState('');
  const [showSignModal, setShowSignModal] = useState(false);
  const [signCertPath, setSignCertPath] = useState('');
  const [signCertPassword, setSignCertPassword] = useState('');
  const [signReason, setSignReason] = useState('');
  const [signLocation, setSignLocation] = useState('');
  const [showSignaturesPanel, setShowSignaturesPanel] = useState(false);
  const [pdfSignatures, setPdfSignatures] = useState<PdfSignatureInfo[]>([]);
  const [signatureVerification, setSignatureVerification] = useState<PdfSignatureVerificationSummary | null>(null);
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false);
  const [pdfBookmarks, setPdfBookmarks] = useState<PdfBookmarkEntry[]>([]);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataAuthor, setMetadataAuthor] = useState('');
  const [metadataSubject, setMetadataSubject] = useState('');
  const [metadataKeywords, setMetadataKeywords] = useState('');
  const [metadataCreator, setMetadataCreator] = useState('');
  const [metadataProducer, setMetadataProducer] = useState('');
  const [metadataCreationDate, setMetadataCreationDate] = useState('');
  const [metadataModDate, setMetadataModDate] = useState('');
  const [pdfPasswordDraft, setPdfPasswordDraft] = useState('');
  const [markdownSaveAsPath, setMarkdownSaveAsPath] = useState('');
  const [nativeDialogs, setNativeDialogs] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [pdfSummary, setPdfSummary] = useState<PdfSummaryResult | null>(null);
  const filePathRef = useRef('');
  const handleMarkdownViewRef = useRef(async () => {});
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('pdf');
  const [markdownText, setMarkdownText] = useState('');
  const [markdownPath, setMarkdownPath] = useState('');
  const [pdfRevision, setPdfRevision] = useState(0);
  const [markdownRevision, setMarkdownRevision] = useState<number | null>(null);
  const [markdownOcrNotice, setMarkdownOcrNotice] = useState<MarkdownOcrNotice | null>(null);
  const [ocrAvailable, setOcrAvailable] = useState<boolean | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showTesseractModal, setShowTesseractModal] = useState(false);
  const [tesseractInstallGuide, setTesseractInstallGuide] = useState<TesseractInstallGuide>(DEFAULT_TESSERACT_GUIDE);
  const [tesseractDoNotRemind, setTesseractDoNotRemind] = useState(false);
  const [tesseractReminderSource, setTesseractReminderSource] = useState<'launch' | 'markdown' | null>(null);

  // Editable page/zoom field values (kept in sync with the canonical state).
  const [pageInput, setPageInput] = useState('1');
  const [zoomInput, setZoomInput] = useState('100');

  // Annotations
  const [highlightMode, setHighlightMode] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [shapeMode, setShapeMode] = useState(false);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('square');
  const [stampMode, setStampMode] = useState(false);
  const [stampKind, setStampKind] = useState<StampKind>('text');
  const [stampPreset, setStampPreset] = useState<string>(STAMP_PRESETS[0].id);
  const [redactMode, setRedactMode] = useState(false);
  const [imageInsertMode, setImageInsertMode] = useState(false);
  const [textEditMode, setTextEditMode] = useState(false);
  const [vectorEditMode, setVectorEditMode] = useState(false);
  const [showPageTextModal, setShowPageTextModal] = useState(false);
  const [showPageEditsModal, setShowPageEditsModal] = useState(false);
  const [pendingTextPos, setPendingTextPos] = useState<{ x: number; y: number } | null>(null);
  const [pageTextDraft, setPageTextDraft] = useState('');
  const [pageTextFontSize, setPageTextFontSize] = useState('14');
  const [editingTextIndex, setEditingTextIndex] = useState<number | null>(null);
  const [pageTextEdits, setPageTextEdits] = useState<PageTextEdit[]>([]);
  const [pageVectorEdits, setPageVectorEdits] = useState<PageVectorEdit[]>([]);
  const [showImageInsertModal, setShowImageInsertModal] = useState(false);
  const [imageSourcePath, setImageSourcePath] = useState('');
  const [imageSourceDraft, setImageSourceDraft] = useState('');
  const [showFormsPanel, setShowFormsPanel] = useState(false);
  const [formFields, setFormFields] = useState<FormFieldData[]>([]);
  const [formDrafts, setFormDrafts] = useState<Record<string, string>>({});
  const [formAddMode, setFormAddMode] = useState(false);
  const [showAddFormFieldModal, setShowAddFormFieldModal] = useState(false);
  const [newFormFieldKind, setNewFormFieldKind] = useState<FormFieldKind>('text');
  const [newFormFieldName, setNewFormFieldName] = useState('');
  const [newFormFieldOptions, setNewFormFieldOptions] = useState('Option A, Option B');
  const [newFormRadioGroup, setNewFormRadioGroup] = useState('');
  const [newFormRadioOption, setNewFormRadioOption] = useState('');
  const [newFormCheckboxChecked, setNewFormCheckboxChecked] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingNotePos, setPendingNotePos] = useState<{ x: number; y: number } | null>(null);
  const {
    highlightStart,
    setHighlightStart,
    highlightRect,
    setHighlightRect,
    inkDrawing,
    setInkDrawing,
    inkDraft,
    setInkDraft,
    shapeLineEnd,
    setShapeLineEnd,
    drawing,
    setDrawing,
    cancelDrawing,
  } = useDrawingGesture();
  const imgRef = useRef<HTMLImageElement>(null);
  const cancelDrawingRef = useRef<() => void>(() => {});
  const loadPdfBookmarksRef = useRef<(path: string) => void>(() => {});
  const loadPageSizesRef = useRef<(path: string) => void>(() => {});

  // Modals
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string>('');
  const [recentPdfs, setRecentPdfs] = useState<string[]>(() => readStoredStringArray(RECENT_PDFS_KEY));
  const [lastBrowserDir, setLastBrowserDir] = useState<string>(() => readStoredString(LAST_BROWSER_DIR_KEY));
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePageInput, setDeletePageInput] = useState('1');
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitRanges, setSplitRanges] = useState<string>('');
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractOutputPath, setExtractOutputPath] = useState('');
  const [showExportPngModal, setShowExportPngModal] = useState(false);
  const [pngExportOutputPath, setPngExportOutputPath] = useState('');
  const [imageExportFormat, setImageExportFormat] = useState<ImageExportFormat>('png');
  const [showDeleteRangeModal, setShowDeleteRangeModal] = useState(false);
  const [showPageNumbersModal, setShowPageNumbersModal] = useState(false);
  const [pageNumbersPrefix, setPageNumbersPrefix] = useState('Page ');
  const [showWatermarkModal, setShowWatermarkModal] = useState(false);
  const [watermarkText, setWatermarkText] = useState('DRAFT');
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropMarginTop, setCropMarginTop] = useState(50);
  const [cropMarginRight, setCropMarginRight] = useState(50);
  const [cropMarginBottom, setCropMarginBottom] = useState(50);
  const [cropMarginLeft, setCropMarginLeft] = useState(50);
  const [showFlattenModal, setShowFlattenModal] = useState(false);
  const [showAddBookmarkModal, setShowAddBookmarkModal] = useState(false);
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [showRenameBookmarkModal, setShowRenameBookmarkModal] = useState(false);
  const [renameBookmarkIndex, setRenameBookmarkIndex] = useState(0);
  const [renameBookmarkTitle, setRenameBookmarkTitle] = useState('');
  const [showDuplicateRangeModal, setShowDuplicateRangeModal] = useState(false);
  const [cropApplyAll, setCropApplyAll] = useState(false);
  const [pageSizes, setPageSizes] = useState<PdfPageSize[]>([]);
  const [showPageHeaderModal, setShowPageHeaderModal] = useState(false);
  const [pageHeaderText, setPageHeaderText] = useState('DRAFT');
  const [showInsertImagePageModal, setShowInsertImagePageModal] = useState(false);
  const [insertImagePagePath, setInsertImagePagePath] = useState('');
  const [insertImageAtIndex, setInsertImageAtIndex] = useState(0);
  const [showExportPagePdfModal, setShowExportPagePdfModal] = useState(false);
  const [exportPagePdfPath, setExportPagePdfPath] = useState('');
  const [showExportPagesPdfModal, setShowExportPagesPdfModal] = useState(false);
  const [exportPagesPdfOutputDir, setExportPagesPdfOutputDir] = useState('');
  const [showPageFooterModal, setShowPageFooterModal] = useState(false);
  const [pageFooterText, setPageFooterText] = useState('Confidential');
  const [showSwapPagesModal, setShowSwapPagesModal] = useState(false);
  const [swapPageA, setSwapPageA] = useState(0);
  const [swapPageB, setSwapPageB] = useState(1);
  const [showReplacePageModal, setShowReplacePageModal] = useState(false);
  const [replaceSourcePath, setReplaceSourcePath] = useState('');
  const [replaceSourcePage, setReplaceSourcePage] = useState(0);
  const [replaceSourcePageCount, setReplaceSourcePageCount] = useState<number | null>(null);
  const [showInterleaveModal, setShowInterleaveModal] = useState(false);
  const [interleaveFilePath, setInterleaveFilePath] = useState('');
  const [interleaveSourcePageCount, setInterleaveSourcePageCount] = useState<number | null>(null);
  const [showPageSizeModal, setShowPageSizeModal] = useState(false);
  const [pageSizePreset, setPageSizePreset] = useState<PageSizePreset>('letter');
  const [showDecryptModal, setShowDecryptModal] = useState(false);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [showRotateRangeModal, setShowRotateRangeModal] = useState(false);
  const [showKeepRangeModal, setShowKeepRangeModal] = useState(false);
  const [showMoveRangeModal, setShowMoveRangeModal] = useState(false);
  const [moveRangeToIndex, setMoveRangeToIndex] = useState(0);
  const [showPrependModal, setShowPrependModal] = useState(false);
  const [prependFilePath, setPrependFilePath] = useState('');
  const [prependSourcePageCount, setPrependSourcePageCount] = useState<number | null>(null);
  const [showSplitEveryModal, setShowSplitEveryModal] = useState(false);
  const [splitEveryN, setSplitEveryN] = useState(2);
  const [showPageBorderModal, setShowPageBorderModal] = useState(false);
  const [pageBorderInset, setPageBorderInset] = useState(20);
  const [showBookmarkAllModal, setShowBookmarkAllModal] = useState(false);
  const [bookmarkAllPrefix, setBookmarkAllPrefix] = useState('Page ');
  const [showExpandMarginsModal, setShowExpandMarginsModal] = useState(false);
  const [expandMarginTop, setExpandMarginTop] = useState(20);
  const [expandMarginRight, setExpandMarginRight] = useState(20);
  const [expandMarginBottom, setExpandMarginBottom] = useState(20);
  const [expandMarginLeft, setExpandMarginLeft] = useState(20);
  const [showShrinkMarginsModal, setShowShrinkMarginsModal] = useState(false);
  const [shrinkMarginTop, setShrinkMarginTop] = useState(20);
  const [shrinkMarginRight, setShrinkMarginRight] = useState(20);
  const [shrinkMarginBottom, setShrinkMarginBottom] = useState(20);
  const [shrinkMarginLeft, setShrinkMarginLeft] = useState(20);
  const [showDeleteNthModal, setShowDeleteNthModal] = useState(false);
  const [deleteNthValue, setDeleteNthValue] = useState(2);
  const [showExtractOddModal, setShowExtractOddModal] = useState(false);
  const [extractOddOutputPath, setExtractOddOutputPath] = useState('');
  const [showExtractEvenModal, setShowExtractEvenModal] = useState(false);
  const [extractEvenOutputPath, setExtractEvenOutputPath] = useState('');
  const [showSplitAtModal, setShowSplitAtModal] = useState(false);
  const [splitAtPage, setSplitAtPage] = useState(1);
  const [showReverseRangeModal, setShowReverseRangeModal] = useState(false);
  const [showInsertBlankPagesModal, setShowInsertBlankPagesModal] = useState(false);
  const [insertBlankCount, setInsertBlankCount] = useState(1);
  const [insertBlankAtIndex, setInsertBlankAtIndex] = useState(0);
  const [showCropRangeModal, setShowCropRangeModal] = useState(false);
  const [showParityRangeModal, setShowParityRangeModal] = useState(false);
  const [parityRangeCommand, setParityRangeCommand] = useState('rotate_odd_pages_in_range');
  const [parityRangeOutputPath, setParityRangeOutputPath] = useState('');
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertFilePath, setInsertFilePath] = useState<string>('');
  const [insertAtPage, setInsertAtPage] = useState<number>(0);
  const [insertSourcePageCount, setInsertSourcePageCount] = useState<number | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeFilePath, setMergeFilePath] = useState('');
  const [mergeSourcePageCount, setMergeSourcePageCount] = useState<number | null>(null);
  // When a source PDF is chosen for Insert, load *its* page count so the From/To
  // range reflects the source document (not the currently open one) and defaults
  // to inserting the whole file.
  useEffect(() => {
    if (!insertFilePath) {
      setInsertSourcePageCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const count = await invoke<number>('get_pdf_page_count', { path: insertFilePath });
        if (cancelled) return;
        setInsertSourcePageCount(count);
        insertRange.reset(0, Math.max(0, count - 1));
      } catch {
        if (!cancelled) setInsertSourcePageCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [insertFilePath]);

  useEffect(() => {
    if (!mergeFilePath) {
      setMergeSourcePageCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const count = await invoke<number>('get_pdf_page_count', { path: mergeFilePath });
        if (cancelled) return;
        setMergeSourcePageCount(count);
        mergeRange.reset(0, Math.max(0, count - 1));
      } catch {
        if (!cancelled) setMergeSourcePageCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [mergeFilePath]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

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


  const pageNumbersRange = usePageRange({ pageCount, currentPage, showToast });
  const watermarkRange = usePageRange({ pageCount, currentPage, showToast });
  const flattenRange = usePageRange({ pageCount, currentPage, showToast });
  const pageHeaderRange = usePageRange({ pageCount, currentPage, showToast });
  const pageFooterRange = usePageRange({ pageCount, currentPage, showToast });
  const pageSizeRange = usePageRange({ pageCount, currentPage, showToast });
  const pageBorderRange = usePageRange({ pageCount, currentPage, showToast });
  const expandMarginsRange = usePageRange({ pageCount, currentPage, showToast });
  const shrinkMarginsRange = usePageRange({ pageCount, currentPage, showToast });
  const pngExportRange = usePageRange({ pageCount, currentPage, defaultScope: 'current', showToast });
  const exportPagesPdfRange = usePageRange({ pageCount, currentPage, showToast });
  const duplicateRange = usePageRangePair({ showToast });
  const deleteRange = usePageRangePair({ showToast });
  const extractRange = usePageRangePair({ showToast });
  const interleaveRange = usePageRangePair({ showToast });
  const rotateRange = usePageRangePair({ showToast });
  const keepRange = usePageRangePair({ showToast });
  const moveRange = usePageRangePair({ showToast });
  const prependRange = usePageRangePair({ showToast });
  const reverseRange = usePageRangePair({ showToast });
  const cropRange = usePageRangePair({ showToast });
  const parityRange = usePageRangePair({ showToast });
  const insertRange = usePageRangePair({ showToast });
  const mergeRange = usePageRangePair({ showToast });

  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  const shouldShowTesseractReminder = useCallback(
    () => ocrAvailable === false && !isTesseractReminderDismissed(),
    [ocrAvailable],
  );

  const closeTesseractReminderModal = useCallback(() => {
    const source = tesseractReminderSource;
    if (tesseractDoNotRemind) dismissTesseractReminder();
    setShowTesseractModal(false);
    setTesseractDoNotRemind(false);
    setTesseractReminderSource(null);
    if (source === 'markdown') {
      void handleMarkdownViewRef.current();
    }
  }, [tesseractDoNotRemind, tesseractReminderSource]);

  const showLaunchTesseractReminder = useCallback(() => {
    setTesseractReminderSource('launch');
    setShowTesseractModal(true);
  }, []);

  useAppBootstrap({
    onNativeDialogs: setNativeDialogs,
    onOcrAvailable: setOcrAvailable,
    onTesseractInstallGuide: setTesseractInstallGuide,
    onShowTesseractReminder: showLaunchTesseractReminder,
  });

  const loadPageEdits = useCallback(async (path: string, page: number) => {
    if (!path) {
      setPageTextEdits([]);
      setPageVectorEdits([]);
      return;
    }
    try {
      const [texts, vectors] = await Promise.all([
        invoke<PageTextEdit[]>('list_page_text_edits', { path, pageIndex: page }),
        invoke<PageVectorEdit[]>('list_page_vectors', { path, pageIndex: page }),
      ]);
      setPageTextEdits(texts);
      setPageVectorEdits(vectors);
    } catch {
      setPageTextEdits([]);
      setPageVectorEdits([]);
    }
  }, []);

  // Mirror dirty state into a ref + reflect it in the window title (the quit
  // handler reads the ref so it isn't stale).
  useEffect(() => {
    isDirtyRef.current = isDirty;
    const name = originalPath ? (originalPath.split('/').pop() ?? '') : '';
    const title = name ? `${isDirty ? '• ' : ''}${name} — PDF Panda` : 'PDF Panda';
    void getCurrentWindow().setTitle(title);
  }, [isDirty, originalPath]);

  // Intercept window close (quit) so unsaved edits prompt first.
  useEffect(() => {
    const w = getCurrentWindow();
    const unlisten = w.onCloseRequested((event) => {
      if (isDirtyRef.current) {
        event.preventDefault();
        pendingNavRef.current = () => w.destroy();
        setShowUnsavedModal(true);
      }
    });
    return () => { void unlisten.then((f) => f()); };
  }, []);

  const rememberBrowserDirectory = useCallback((path: string) => {
    const dir = directoryFromPath(path);
    if (!dir) return;
    setLastBrowserDir(dir);
    writeStoredString(LAST_BROWSER_DIR_KEY, dir);
  }, []);

  const handleSaveRef = useRef<() => void | Promise<void>>(async () => {});

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

  const { rememberOpenedPdf } = usePdfRecents({ rememberBrowserDirectory, setRecentPdfs });

  const withLoading = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setLoading(true);
    try {
      return await fn();
    } catch (err) {
      showToast(String(err), 'error');
      return undefined;
    } finally {
      setLoading(false);
    }
  };

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
    cancelDrawing: () => cancelDrawingRef.current(),
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

  // Keep the editable fields in sync when page/zoom change via buttons, wheel, etc.
  useEffect(() => setPageInput(String(currentPage + 1)), [currentPage]);
  useEffect(() => setZoomInput(String(Math.round(zoom * 100))), [zoom]);

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
  } = usePdfBrowser({
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
  } = usePdfSearch({
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

  const { scrollRef, handleWheel, handleImageLoad } = useWheelNavigation({
    pageCount,
    viewMode,
    currentPage,
    goToPage,
  });

  const { handleDragStart, handleDragOver, handleDrop } = useThumbnailReorder({
    filePath,
    draggedIndex,
    withLoading,
    markPdfEdited,
    loadThumbnails,
    renderPage,
    setDraggedIndex,
    setCurrentPage,
  });

  const {
    defaultExtractOutputPath,
    openDeleteModal,
    openInsertModal,
    openSplitModal,
    openExtractModal,
  } = usePdfModalOpeners({
    filePath,
    originalPath,
    currentPage,
    pageCount,
    extractRange,
    setDeletePageInput,
    setShowDeleteModal,
    setShowInsertModal,
    setShowSplitModal,
    setExtractOutputPath,
    setShowExtractModal,
  });

  const { defaultImageExportOutput, openExportPngModal, handleExportPng } = useImageExportActions({
    filePath,
    originalPath,
    currentPage,
    pageCount,
    imageExportFormat,
    pngExportOutputPath,
    pngExportRange,
    withLoading,
    showToast,
    setPngExportOutputPath,
    setShowExportPngModal,
  });

  const runEdit = useStructuralEdit({
    filePath,
    currentPage,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    showToast,
  });


  const {
    handleRotatePageCcw,
    handleResetPageRotation,
    handleResetAllRotations,
    handleReversePages,
    handleRotateAllPages,
    handleAddBlankPage,
    handleAddBlankPageBefore,
    handleRotatePage180,
    handleRotateAllPagesCcw,
    handleMovePageToFirst,
    handleMovePageToLast,
    handleClearAllCrops,
    handleClearAllBookmarks,
    handleMovePageUp,
    handleMovePageDown,
  } = useSinglePageEditActions({ filePath, currentPage, pageCount, runEdit, loadPdfBookmarks });

  const {
    openDuplicateRangeModal,
    handleDuplicatePageRange,
    handleDuplicatePageRangeToEnd,
    handleDuplicatePageRangeToStart,
    handleDuplicatePageRangeBefore,
  } = useDuplicateRangeActions({ filePath, pageCount, currentPage, duplicateRange, runEdit, setShowDuplicateRangeModal });

  const {
    openPageHeaderModal,
    handleAddPageHeader,
    handleAddPageHeaderOddPages,
    handleAddPageHeaderEvenPages,
    openPageFooterModal,
    handleAddPageFooter,
    handleAddPageFooterOddPages,
    handleAddPageFooterEvenPages,
  } = usePageHeaderFooterActions({
    filePath,
    pageCount,
    pageHeaderText,
    pageFooterText,
    pageHeaderRange,
    pageFooterRange,
    runEdit,
    setPageHeaderText,
    setPageFooterText,
    setShowPageHeaderModal,
    setShowPageFooterModal,
  });

  const {
    openSwapPagesModal,
    handleSwapPages,
    openReplacePageModal,
    handleReplaceSourcePathChange,
    handleReplacePage,
    openInterleaveModal,
    handleInterleaveSourcePathChange,
    handleInterleavePdf,
  } = useSwapReplaceInterleaveActions({
    filePath,
    pageCount,
    currentPage,
    swapPageA,
    swapPageB,
    replaceSourcePath,
    replaceSourcePage,
    interleaveFilePath,
    interleaveRange,
    runEdit,
    showToast,
    setSwapPageA,
    setSwapPageB,
    setShowSwapPagesModal,
    setReplaceSourcePath,
    setReplaceSourcePage,
    setReplaceSourcePageCount,
    setShowReplacePageModal,
    setInterleaveFilePath,
    setInterleaveSourcePageCount,
    setShowInterleaveModal,
  });

  const {
    handleSplitOddEven,
    handleDuplicateAllPages,
    openPageSizeModal,
    handleSetPageSize,
    handleSetPageSizeOddPages,
    handleSetPageSizeEvenPages,
  } = usePageSizeActions({
    filePath,
    pageCount,
    pageSizePreset,
    pageSizeRange,
    runEdit,
    withLoading,
    showToast,
    setPageSizePreset,
    setShowPageSizeModal,
  });

  const {
    openExportPagesPdfModal,
    handleExportPagesPdf,
    handleExportOddPagesAsPdf,
    handleExportEvenPagesAsPdf,
    openExportPagePdfModal,
    handleExportPagePdf,
  } = useExportPagesActions({
    filePath,
    originalPath,
    pageCount,
    currentPage,
    exportPagesPdfOutputDir,
    exportPagePdfPath,
    exportPagesPdfRange,
    withLoading,
    showToast,
    setExportPagesPdfOutputDir,
    setExportPagePdfPath,
    setShowExportPagesPdfModal,
    setShowExportPagePdfModal,
  });

  const {
    openParityRangeModal,
    handleParityRangeAction,
    handleExportOddPagesImage,
    handleExportEvenPagesImage,
  } = useParityExportActions({
    filePath,
    pageCount,
    currentPage,
    parityRange,
    parityRangeCommand,
    parityRangeOutputPath,
    cropMarginTop,
    cropMarginRight,
    cropMarginBottom,
    cropMarginLeft,
    watermarkText,
    pageHeaderText,
    pageFooterText,
    pageBorderInset,
    pageSizePreset,
    pageNumbersPrefix,
    pngExportOutputPath,
    imageExportFormat,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    showToast,
    setParityRangeCommand,
    setShowParityRangeModal,
    setShowExportPngModal,
  });

  const {
    openRotateRangeModal,
    handleRotatePageRange,
    handleResetRotationRange,
    handleRotatePage180Range,
    openReverseRangeModal,
    handleReversePageRange,
    openInsertBlankPagesModal,
    handleInsertBlankPages,
    openCropRangeModal,
    handleCropPageRange,
    handleFlattenAllAnnotations,
    handleClearPdfMetadata,
    handleSortPagesBySize,
    openKeepRangeModal,
    handleKeepPageRange,
    openMoveRangeModal,
    handleMovePageRange,
    handleMovePageRangeToStart,
    handleMovePageRangeToEnd,
    openDeleteRangeModal,
    handleDeletePageRange,
  } = useRangeModalActions({
    filePath,
    pageCount,
    currentPage,
    rotateRange,
    reverseRange,
    cropRange,
    keepRange,
    moveRange,
    deleteRange,
    insertBlankCount,
    insertBlankAtIndex,
    moveRangeToIndex,
    cropMarginTop,
    cropMarginRight,
    cropMarginBottom,
    cropMarginLeft,
    runEdit,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    showToast,
    setInsertBlankCount,
    setInsertBlankAtIndex,
    setMoveRangeToIndex,
    setCropMarginTop,
    setCropMarginRight,
    setCropMarginBottom,
    setCropMarginLeft,
    setMetadataTitle,
    setMetadataAuthor,
    setMetadataSubject,
    setMetadataKeywords,
    setMetadataCreator,
    setMetadataProducer,
    setMetadataCreationDate,
    setMetadataModDate,
    setShowRotateRangeModal,
    setShowReverseRangeModal,
    setShowInsertBlankPagesModal,
    setShowCropRangeModal,
    setShowKeepRangeModal,
    setShowMoveRangeModal,
    setShowDeleteRangeModal,
  });

  const {
    handleRotateOddPages,
    handleRotateEvenPages,
    handleRotateOddPagesCcw,
    handleRotateEvenPagesCcw,
    handleResetRotationOddPages,
    handleResetRotationEvenPages,
    handleKeepOddPages,
    handleKeepEvenPages,
    handleDeleteOddPages,
    handleDeleteEvenPages,
    handleRotate180OddPages,
    handleRotate180EvenPages,
    handleDuplicateOddPages,
    handleDuplicateEvenPages,
    handleInsertBlankBetweenPages,
    handleFlattenOddPages,
    handleFlattenEvenPages,
    handleRotateAllPages180,
    handleCropOddPages,
    handleCropEvenPages,
    handleExpandOddPages,
    handleExpandEvenPages,
    handleShrinkOddPages,
    handleShrinkEvenPages,
  } = useOddEvenPageActions({
    filePath,
    pageCount,
    currentPage,
    cropMargins: { marginTop: cropMarginTop, marginRight: cropMarginRight, marginBottom: cropMarginBottom, marginLeft: cropMarginLeft },
    expandMargins: { marginTop: expandMarginTop, marginRight: expandMarginRight, marginBottom: expandMarginBottom, marginLeft: expandMarginLeft },
    shrinkMargins: { marginTop: shrinkMarginTop, marginRight: shrinkMarginRight, marginBottom: shrinkMarginBottom, marginLeft: shrinkMarginLeft },
    runEdit,
    setShowCropRangeModal,
    setShowExpandMarginsModal,
    setShowShrinkMarginsModal,
  });

  const {
    handleReverseOddPages,
    handleReverseEvenPages,
    handleMoveOddPagesToStart,
    handleMoveEvenPagesToStart,
    handleMoveOddPagesToEnd,
    handleMoveEvenPagesToEnd,
    handleClearCropOddPages,
    handleClearCropEvenPages,
    handleDuplicateOddPagesBefore,
    handleDuplicateEvenPagesBefore,
    handleSortOddPagesByRotation,
    handleSortEvenPagesByRotation,
    handleSortOddPagesBySize,
    handleSortEvenPagesBySize,
    handleSortPagesByRotation,
  } = useOddEvenExtendedActions({
    filePath,
    pageCount,
    runEdit,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    showToast,
    setShowCropModal,
  });

  const {
    openSplitAtModal,
    handleSplitPdfAtPage,
    openDeleteNthModal,
    handleDeleteEveryNthPage,
    openExtractOddModal,
    handleExtractOddPages,
    openExtractEvenModal,
    handleExtractEvenPages,
    openPrependModal,
    handlePrependSourcePathChange,
    handlePrependPdf,
    openSplitEveryModal,
    handleSplitEveryN,
  } = useSplitExtractPrependActions({
    filePath,
    originalPath,
    pageCount,
    currentPage,
    splitAtPage,
    deleteNthValue,
    extractOddOutputPath,
    extractEvenOutputPath,
    prependFilePath,
    prependRange,
    splitEveryN,
    runEdit,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    showToast,
    setSplitAtPage,
    setDeleteNthValue,
    setExtractOddOutputPath,
    setExtractEvenOutputPath,
    setPrependFilePath,
    setPrependSourcePageCount,
    setSplitEveryN,
    setShowSplitAtModal,
    setShowDeleteNthModal,
    setShowExtractOddModal,
    setShowExtractEvenModal,
    setShowPrependModal,
    setShowSplitEveryModal,
  });

  const {
    openPageBorderModal,
    handleAddPageBorder,
    handleAddPageBorderOddPages,
    handleAddPageBorderEvenPages,
    handleInsertBlankBeforeOddPages,
    handleInsertBlankBeforeEvenPages,
    handleInsertBlankAfterOddPages,
    handleInsertBlankAfterEvenPages,
    handleDuplicateOddPagesToEnd,
    handleDuplicateEvenPagesToEnd,
    handleDuplicateOddPagesToStart,
    handleDuplicateEvenPagesToStart,
    openExpandMarginsModal,
    openShrinkMarginsModal,
    handleShrinkPageMargins,
    handleExpandPageMargins,
    openInsertImagePageModal,
    handleInsertImagePage,
    openPageNumbersModal,
    handleAddPageNumbers,
    handleAddPageNumbersOddPages,
    handleAddPageNumbersEvenPages,
    openWatermarkModal,
    handleAddWatermark,
    handleAddWatermarkOddPages,
    handleAddWatermarkEvenPages,
    openCropModal,
    handleCropPage,
    handleClearPageCrop,
    openFlattenModal,
    handleFlattenAnnotations,
  } = usePageDecorActions({
    filePath,
    pageCount,
    currentPage,
    pageBorderRange,
    expandMarginsRange,
    shrinkMarginsRange,
    pageNumbersRange,
    watermarkRange,
    flattenRange,
    pageBorderInset,
    expandMarginTop,
    expandMarginRight,
    expandMarginBottom,
    expandMarginLeft,
    shrinkMarginTop,
    shrinkMarginRight,
    shrinkMarginBottom,
    shrinkMarginLeft,
    cropMarginTop,
    cropMarginRight,
    cropMarginBottom,
    cropMarginLeft,
    cropApplyAll,
    pageNumbersPrefix,
    watermarkText,
    insertImageAtIndex,
    insertImagePagePath,
    runEdit,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    loadPageSizes,
    showToast,
    setPageBorderInset,
    setExpandMarginTop,
    setExpandMarginRight,
    setExpandMarginBottom,
    setExpandMarginLeft,
    setShrinkMarginTop,
    setShrinkMarginRight,
    setShrinkMarginBottom,
    setShrinkMarginLeft,
    setCropMarginTop,
    setCropMarginRight,
    setCropMarginBottom,
    setCropMarginLeft,
    setCropApplyAll,
    setPageNumbersPrefix,
    setWatermarkText,
    setInsertImageAtIndex,
    setInsertImagePagePath,
    setShowPageBorderModal,
    setShowExpandMarginsModal,
    setShowShrinkMarginsModal,
    setShowInsertImagePageModal,
    setShowPageNumbersModal,
    setShowWatermarkModal,
    setShowCropModal,
    setShowFlattenModal,
  });

  const bookmarkActions = useBookmarkActions({
    filePath,
    currentPage,
    bookmarkTitle,
    bookmarkAllPrefix,
    renameBookmarkIndex,
    renameBookmarkTitle,
    runEdit,
    loadPdfBookmarks,
    setBookmarkTitle,
    setBookmarkAllPrefix,
    setRenameBookmarkIndex,
    setRenameBookmarkTitle,
    setShowAddBookmarkModal,
    setShowRenameBookmarkModal,
    setShowBookmarkAllModal,
  });
  const {
    openAddBookmarkModal,
    handleAddBookmark,
    openRenameBookmarkModal,
    handleRenameBookmark,
    handleRemoveBookmark,
    openBookmarkAllModal,
    handleBookmarkAllPages,
    handleBookmarkOddPages,
    handleBookmarkEvenPages,
  } = bookmarkActions;

  const { openMergeModal, handleSplitPdf, handleDeletePage, handleExtractPdf, handleInsertPdf, handleMergePdf, handleOptimizePdf } = usePdfFileOpsActions({
    filePath,
    pageCount,
    currentPage,
    deletePageInput,
    splitRanges,
    insertFilePath,
    insertAtPage,
    mergeFilePath,
    extractOutputPath,
    insertRange,
    mergeRange,
    extractRange,
    withLoading,
    markPdfEdited,
    loadThumbnails,
    renderPage,
    showToast,
    setPageCount,
    setCurrentPage,
    setDeletePageInput,
    setShowDeleteModal,
    setShowSplitModal,
    setSplitRanges,
    setShowInsertModal,
    setInsertFilePath,
    setInsertAtPage,
    setShowMergeModal,
    setMergeFilePath,
    setShowExtractModal,
  });

  const { handleRotatePage, handleDuplicatePageBefore, handleDuplicatePage, handleDuplicatePageToEnd } = usePageDuplicateActions({
    filePath,
    currentPage,
    pageInput,
    withLoading,
    markPdfEdited,
    loadThumbnails,
    renderPage,
    runEdit,
    showToast,
    setPageCount,
    setCurrentPage,
    setPageInput,
  });

  const applyFormField = (name: string) => {
    const field = formFields.find((entry) => entry.name === name);
    if (!field || !filePath) return;
    const draft = formDrafts[name] ?? '';
    void withLoading(async () => {
      await invoke('set_pdf_form_field', { path: filePath, name, value: draft });
      markPdfEdited();
      await loadFormFields(filePath);
      showToast(`Updated ${name}`);
    });
  };

  useEffect(() => {
    if (filePath) void loadFormFields(filePath);
  }, [filePath, pdfRevision, loadFormFields]);

  useEffect(() => {
    if (filePath) void loadPdfSignatures(filePath);
  }, [filePath, pdfRevision, loadPdfSignatures]);

  useEffect(() => {
    if (filePath) void loadPdfBookmarks(filePath);
  }, [filePath, pdfRevision, loadPdfBookmarks]);

  useEffect(() => {
    if (filePath) void loadPageSizes(filePath);
  }, [filePath, pdfRevision, loadPageSizes]);

  cancelDrawingRef.current = cancelDrawing;

  const {
    refreshAnnotations,
    handlePageClick,
    handlePageMouseMove,
    handleDrawMouseDown,
    handleDrawMouseUp,
    removeRedaction,
    removeStamp,
    removeShape,
    removeInkStroke,
    removeHighlight,
    removeTextNote,
  } = usePageInteraction({
    filePath,
    currentPage,
    zoom,
    imgRef,
    withLoading,
    markPdfEdited,
    renderPage,
    loadFormFields,
    runEdit,
    setAnnotations,
    drawMode,
    textEditMode,
    vectorEditMode,
    formAddMode,
    imageInsertMode,
    redactMode,
    stampMode,
    shapeMode,
    noteMode,
    highlightMode,
    drawing,
    highlightStart,
    inkDrawing,
    inkDraft,
    shapeKind,
    stampKind,
    stampPreset,
    imageSourcePath,
    newFormFieldKind,
    newFormFieldName,
    newFormFieldOptions,
    newFormRadioGroup,
    newFormRadioOption,
    newFormCheckboxChecked,
    cancelDrawing,
    setHighlightStart,
    setHighlightRect,
    setDrawing,
    setShapeLineEnd,
    setInkDrawing,
    setInkDraft,
    setPendingTextPos,
    setPageTextDraft,
    setEditingTextIndex,
    setShowPageTextModal,
    setPendingNotePos,
    setNoteDraft,
    setShowNoteModal,
    setFormAddMode,
    setShowAddFormFieldModal,
    setNewFormFieldName,
    setNewFormRadioGroup,
    setNewFormRadioOption,
    showToast,
  });

  const {
    openImageInsertModal,
    confirmImageSource,
    toggleImageInsertMode,
    exitImageInsertMode,
    openAddFormFieldModal,
    confirmAddFormField,
    exitFormAddMode,
    toggleHighlightMode,
    exitHighlightMode,
    toggleNoteMode,
    toggleDrawMode,
    exitDrawMode,
    toggleShapeMode,
    exitShapeMode,
    toggleStampMode,
    exitStampMode,
    toggleTextEditMode,
    toggleVectorEditMode,
    toggleRedactMode,
    exitRedactMode,
    exitNoteMode,
    toggleFormsPanel,
  } = useAnnotationModes({
    cancelDrawing,
    setHighlightMode,
    setNoteMode,
    setDrawMode,
    setShapeMode,
    setStampMode,
    setRedactMode,
    setImageInsertMode,
    setFormAddMode,
    setTextEditMode,
    setVectorEditMode,
    setShowNoteModal,
    setPendingNotePos,
    setNoteDraft,
    filePath,
    imageSourcePath,
    imageSourceDraft,
    newFormFieldKind,
    newFormFieldName,
    newFormFieldOptions,
    newFormRadioGroup,
    newFormRadioOption,
    newFormCheckboxChecked,
    showToast,
    setImageSourceDraft,
    setImageSourcePath,
    setShowImageInsertModal,
    setShowAddFormFieldModal,
    setNewFormFieldKind,
    setNewFormFieldName,
    setNewFormFieldOptions,
    setNewFormRadioGroup,
    setNewFormRadioOption,
    setNewFormCheckboxChecked,
    setShowFormsPanel,
  });

  const {
    submitPageText,
    startEditPageText,
    closePageTextModal,
    exitTextEditMode,
    exitVectorEditMode,
    removePageTextEdit,
    removePageVectorEdit,
  } = usePageTextEdits({
    filePath,
    currentPage,
    pageTextDraft,
    pageTextFontSize,
    pendingTextPos,
    editingTextIndex,
    withLoading,
    markPdfEdited,
    renderPage,
    showToast,
    setShowPageTextModal,
    setShowPageEditsModal,
    setPendingTextPos,
    setEditingTextIndex,
    setPageTextDraft,
    setPageTextFontSize,
    setTextEditMode,
    setVectorEditMode,
    cancelDrawing,
  });

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPendingEncryptedPath('');
    setPdfPasswordDraft('');
  };

  const submitTextNote = () => {
    const text = noteDraft.trim();
    const pos = pendingNotePos;
    if (!text || !pos) return;
    void withLoading(async () => {
      await invoke('add_text_note', {
        path: filePath,
        pageIndex: currentPage,
        x: pos.x,
        y: pos.y,
        content: text,
      });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Note added');
      exitNoteMode();
    });
  };

  const {
    chooseOpenPdfNative,
    chooseInsertPdfNative,
    chooseMergePdfNative,
    handleSaveAs,
    saveAsViaNativeDialog,
    chooseSaveAsNative,
    chooseExtractOutputNative,
    chooseExportPngOutputNative,
    chooseSignCertNative,
  } = useNativeFilePickers({
    filePath,
    originalPath,
    openFilePath,
    insertFilePath,
    mergeFilePath,
    saveAsPath,
    extractOutputPath,
    pngExportOutputPath,
    signCertPath,
    lastBrowserDir,
    imageExportFormat,
    pngExportScope: pngExportRange.scope,
    pngExportStartPage: pngExportRange.startPage,
    pngExportEndPage: pngExportRange.endPage,
    extractStartPage: extractRange.startPage,
    extractEndPage: extractRange.endPage,
    currentPage,
    withLoading,
    loadPdfFromPath,
    rememberOpenedPdf,
    rememberBrowserDirectory,
    markSaved,
    defaultExtractOutputPath,
    defaultImageExportOutput,
    setOpenFilePath,
    setShowOpenModal,
    setInsertFilePath,
    setMergeFilePath,
    setSaveAsPath,
    setShowSaveAsModal,
    setOriginalPath,
    setExtractOutputPath,
    setPngExportOutputPath,
    setSignCertPath,
    showToast,
  });

  const { handleSave, openSaveAs } = useSaveActions({
    filePath,
    originalPath,
    nativeDialogs,
    withLoading,
    markSaved,
    showToast,
    saveAsViaNativeDialog,
    setSaveAsPath,
    setShowSaveAsModal,
  });
  handleSaveRef.current = handleSave;

  const {
    handleMarkdownView,
    toggleMarkdownView,
    handleMarkdownSaveAs,
    chooseMarkdownSaveAsNative,
    openMarkdownSaveAs,
    handleSummarizePdf,
    handleCopySummary,
    handleSaveSummary,
  } = useMarkdownFlow({
    filePath,
    originalPath,
    viewMode,
    markdownText,
    markdownPath,
    markdownSaveAsPath,
    pdfRevision,
    markdownRevision,
    nativeDialogs,
    pdfSummary,
    withLoading,
    shouldShowTesseractReminder,
    setViewMode,
    setMarkdownText,
    setMarkdownPath,
    setMarkdownRevision,
    setMarkdownOcrNotice,
    setShowMarkdownSaveAsModal,
    setMarkdownSaveAsPath,
    setTesseractReminderSource,
    setShowTesseractModal,
    setPdfSummary,
    setShowSummaryModal,
    showToast,
  });
  handleMarkdownViewRef.current = handleMarkdownView;


  const {
    openProtectModal,
    openDecryptModal,
    handleRemovePdfPassword,
    openMetadataModal,
    handleSaveMetadata,
    handleProtectPdf,
    openSignModal,
    handleSignPdf,
    toggleSignaturesPanel,
  } = useSecurityDocumentActions({
    filePath,
    originalPath,
    protectUserPassword,
    protectUserPasswordConfirm,
    protectOwnerPassword,
    decryptPassword,
    signCertPath,
    signCertPassword,
    signReason,
    signLocation,
    metadataTitle,
    metadataAuthor,
    metadataSubject,
    metadataKeywords,
    metadataCreator,
    metadataProducer,
    withLoading,
    markPdfEdited,
    runEdit,
    loadPdfSignatures,
    showToast,
    setProtectUserPassword,
    setProtectUserPasswordConfirm,
    setProtectOwnerPassword,
    setShowProtectModal,
    setDecryptPassword,
    setShowDecryptModal,
    setSignCertPath,
    setSignCertPassword,
    setSignReason,
    setSignLocation,
    setShowSignModal,
    setPdfRevision,
    setMetadataTitle,
    setMetadataAuthor,
    setMetadataSubject,
    setMetadataKeywords,
    setMetadataCreator,
    setMetadataProducer,
    setMetadataCreationDate,
    setMetadataModDate,
    setShowMetadataModal,
    setShowSignaturesPanel,
  });

  const { zoomIn, zoomOut, resetZoom, commitZoom, commitPage } = usePageZoom({
    zoom,
    setZoom,
    zoomInput,
    setZoomInput,
    pageInput,
    setPageInput,
    pageCount,
    currentPage,
    goToPage,
  });

  const { dismissModals, anyModalOpen } = useModalDismiss({
    showUnsavedModal,
    showSaveAsModal,
    showMarkdownSaveAsModal,
    showProtectModal,
    showSignModal,
    showMetadataModal,
    showPasswordModal,
    showOpenModal,
    showBrowserModal,
    showDeleteModal,
    showSplitModal,
    showExtractModal,
    showExportPngModal,
    showDeleteRangeModal,
    showPageNumbersModal,
    showWatermarkModal,
    showCropModal,
    showFlattenModal,
    showAddBookmarkModal,
    showRenameBookmarkModal,
    showDuplicateRangeModal,
    showPageHeaderModal,
    showPageFooterModal,
    showSwapPagesModal,
    showReplacePageModal,
    showInterleaveModal,
    showPageSizeModal,
    showDecryptModal,
    showRotateRangeModal,
    showKeepRangeModal,
    showMoveRangeModal,
    showPrependModal,
    showSplitEveryModal,
    showPageBorderModal,
    showBookmarkAllModal,
    showExpandMarginsModal,
    showShrinkMarginsModal,
    showDeleteNthModal,
    showExtractOddModal,
    showExtractEvenModal,
    showSplitAtModal,
    showReverseRangeModal,
    showInsertBlankPagesModal,
    showCropRangeModal,
    showParityRangeModal,
    showExportPagesPdfModal,
    showInsertImagePageModal,
    showExportPagePdfModal,
    showInsertModal,
    showMergeModal,
    showSearchModal,
    showNoteModal,
    showImageInsertModal,
    showAddFormFieldModal,
    showSummaryModal,
    showPageTextModal,
    showPageEditsModal,
    showCommandPalette,
    showShortcutsHelp,
    showLicenses,
    showCredits,
    showAbout,
    showTesseractModal,
    closeSearchModal,
    resolveUnsaved,
    setShowSaveAsModal,
    setShowMarkdownSaveAsModal,
    setShowProtectModal,
    setShowSignModal,
    setShowMetadataModal,
    setShowPasswordModal,
    setPendingEncryptedPath,
    setPdfPasswordDraft,
    setShowOpenModal,
    setShowBrowserModal,
    setShowDeleteModal,
    setShowSplitModal,
    setShowExtractModal,
    setShowExportPngModal,
    setShowDeleteRangeModal,
    setShowPageNumbersModal,
    setShowWatermarkModal,
    setShowCropModal,
    setShowFlattenModal,
    setShowAddBookmarkModal,
    setShowRenameBookmarkModal,
    setShowDuplicateRangeModal,
    setShowPageHeaderModal,
    setShowPageFooterModal,
    setShowSwapPagesModal,
    setShowReplacePageModal,
    setShowInterleaveModal,
    setShowPageSizeModal,
    setShowDecryptModal,
    setShowRotateRangeModal,
    setShowKeepRangeModal,
    setShowMoveRangeModal,
    setShowPrependModal,
    setShowSplitEveryModal,
    setShowPageBorderModal,
    setShowBookmarkAllModal,
    setShowExpandMarginsModal,
    setShowReverseRangeModal,
    setShowInsertBlankPagesModal,
    setShowCropRangeModal,
    setShowExportPagesPdfModal,
    setShowInsertImagePageModal,
    setShowExportPagePdfModal,
    setShowInsertModal,
    setInsertFilePath,
    setShowMergeModal,
    setMergeFilePath,
    setShowImageInsertModal,
    setShowAddFormFieldModal,
    setShowSummaryModal,
    setShowPageTextModal,
    setEditingTextIndex,
    setPendingTextPos,
    setShowPageEditsModal,
    setShowCommandPalette,
    setShowShortcutsHelp,
    setShowLicenses,
    setShowCredits,
    setShowAbout,
    setShowTesseractModal,
  });

  const keyboardActionsRef = useRef<AppKeyboardActions>({} as AppKeyboardActions);
  keyboardActionsRef.current = {
    isDirty,
    canUndo,
    canRedo,
    hasOpenPdf: !!filePath,
    noteMode,
    drawMode,
    shapeMode,
    stampMode,
    redactMode,
    imageInsertMode,
    textEditMode,
    vectorEditMode,
    formAddMode,
    highlightMode,
    anyModalOpen,
    pageCount,
    currentPage,
    viewMode,
    openPdf,
    openCommandPalette: () => setShowCommandPalette(true),
    dismissModals,
    exitNoteMode,
    exitDrawMode,
    exitShapeMode,
    exitStampMode,
    exitRedactMode,
    exitImageInsertMode,
    exitTextEditMode,
    exitVectorEditMode,
    exitFormAddMode,
    exitHighlightMode,
    goToPage,
    toggleHighlightMode,
    toggleNoteMode,
    toggleDrawMode,
    toggleShapeMode,
    toggleStampMode,
    toggleRedactMode,
    toggleTextEditMode,
    toggleVectorEditMode,
    toggleImageInsertMode,
    toggleFormsPanel,
    openDeleteModal,
    openSaveAs,
    handleSave,
    requestClosePdf: () => guardUnsaved(closePdf),
    handlePrint,
    handleRotatePage,
    openSearchModal,
    handleDuplicatePage,
    toggleMarkdownView,
    handleOptimizePdf,
    handleSummarizePdf,
    openSignModal,
    openInsertModal,
    openSplitModal,
    openExtractModal,
    openExportPngModal,
    handleAddBlankPage,
    handleReversePages,
    openMergeModal,
    zoomIn,
    zoomOut,
    resetZoom,
    undo,
    redo,
  };
  useAppKeyboard(keyboardActionsRef);

  const appMenus = buildAppMenus(buildAppMenuContext({
    hasPdf: !!filePath,
    isDirty,
    canUndo,
    canRedo,
    pageCount,
    currentPage,
    viewMode,
    highlightMode,
    noteMode,
    drawMode,
    shapeMode,
    stampMode,
    redactMode,
    imageInsertMode,
    textEditMode,
    vectorEditMode,
    showFormsPanel,
    showBookmarksPanel,
    showSignaturesPanel,
    tesseractInstalled: ocrAvailable === true,
    openPdf,
    handleSave,
    openSaveAs,
    requestClosePdf: () => guardUnsaved(closePdf),
    undo,
    redo,
    handlePrint,
    openSearchModal,
    handleRotatePage,
    handleRotatePageCcw,
    handleResetPageRotation,
    handleRotatePage180,
    handleRotateAllPages,
    handleRotateAllPagesCcw,
    handleRotateAllPages180,
    handleRotateOddPages,
    handleRotateEvenPages,
    handleRotateOddPagesCcw,
    handleRotateEvenPagesCcw,
    handleRotate180OddPages,
    handleRotate180EvenPages,
    handleResetRotationOddPages,
    handleResetRotationEvenPages,
    handleResetAllRotations,
    openRotateRangeModal,
    handleDuplicatePage,
    handleDuplicatePageBefore,
    openDuplicateRangeModal,
    openParityRangeModal,
    openMoveRangeModal,
    openKeepRangeModal,
    handleKeepOddPages,
    handleKeepEvenPages,
    handleDeleteOddPages,
    handleDeleteEvenPages,
    handleAddBlankPage,
    handleAddBlankPageBefore,
    openInsertBlankPagesModal,
    handleInsertBlankBetweenPages,
    handleInsertBlankBeforeOddPages,
    handleInsertBlankBeforeEvenPages,
    handleInsertBlankAfterOddPages,
    handleInsertBlankAfterEvenPages,
    handleMovePageToFirst,
    handleMovePageToLast,
    handleMovePageUp,
    handleMovePageDown,
    openSwapPagesModal,
    handleReversePages,
    openReverseRangeModal,
    handleReverseOddPages,
    handleReverseEvenPages,
    handleMoveOddPagesToStart,
    handleMoveEvenPagesToStart,
    handleMoveOddPagesToEnd,
    handleMoveEvenPagesToEnd,
    handleSplitOddEven,
    handleDuplicateAllPages,
    handleDuplicatePageToEnd,
    handleDuplicateOddPages,
    handleDuplicateEvenPages,
    handleDuplicateOddPagesBefore,
    handleDuplicateEvenPagesBefore,
    handleDuplicateOddPagesToEnd,
    handleDuplicateEvenPagesToEnd,
    handleDuplicateOddPagesToStart,
    handleDuplicateEvenPagesToStart,
    openDeleteModal,
    openDeleteRangeModal,
    openDeleteNthModal,
    openInsertModal,
    openMergeModal,
    openInterleaveModal,
    openPrependModal,
    openReplacePageModal,
    openSplitModal,
    openSplitAtModal,
    openSplitEveryModal,
    openExtractModal,
    openExtractOddModal,
    openExtractEvenModal,
    setViewModePdf: () => setViewMode('pdf'),
    toggleMarkdownView,
    handleOptimizePdf,
    openExportPngModal,
    openExportPagePdfModal,
    openExportPagesPdfModal,
    openInsertImagePageModal,
    openPageNumbersModal,
    openPageHeaderModal,
    openPageFooterModal,
    openPageSizeModal,
    openWatermarkModal,
    openCropModal,
    openCropRangeModal,
    handleCropOddPages,
    handleCropEvenPages,
    openExpandMarginsModal,
    openShrinkMarginsModal,
    openPageBorderModal,
    openFlattenModal,
    handleFlattenAllAnnotations,
    handleFlattenOddPages,
    handleFlattenEvenPages,
    handleSortPagesBySize,
    handleSortOddPagesBySize,
    handleSortEvenPagesBySize,
    handleSortPagesByRotation,
    handleSortOddPagesByRotation,
    handleSortEvenPagesByRotation,
    openMetadataModal,
    handleSummarizePdf,
    openProtectModal,
    openDecryptModal,
    openSignModal,
    toggleSignaturesPanel,
    toggleBookmarksPanel: () => setShowBookmarksPanel((prev) => !prev),
    toggleRedactMode,
    toggleHighlightMode,
    toggleNoteMode,
    toggleDrawMode,
    toggleShapeMode,
    toggleStampMode,
    toggleImageInsertMode,
    toggleTextEditMode,
    toggleVectorEditMode,
    openPageEditsModal: () => setShowPageEditsModal(true),
    toggleFormsPanel,
    openTesseractGuide: () => {
      setTesseractReminderSource('launch');
      setShowTesseractModal(true);
    },
    openShortcutsHelp: () => setShowShortcutsHelp(true),
    openLicenses: () => setShowLicenses(true),
    openCredits: () => setShowCredits(true),
    openAbout: () => setShowAbout(true),
    openCommandPalette: () => setShowCommandPalette(true),
  }));

  const modeToolbarExtras = filePath ? (
    <ModeToolbarExtras
      imageInsertMode={imageInsertMode}
      imageSourcePath={imageSourcePath}
      onOpenImageInsertModal={openImageInsertModal}
      stampMode={stampMode}
      stampKind={stampKind}
      stampPreset={stampPreset}
      onStampKindChange={setStampKind}
      onStampPresetChange={setStampPreset}
      shapeMode={shapeMode}
      shapeKind={shapeKind}
      onShapeKindChange={setShapeKind}
    />
  ) : null;

  const windowTitle = originalPath
    ? `${isDirty ? '• ' : ''}${originalPath.split('/').pop() ?? ''} — PDF Panda`
    : 'PDF Panda';

  const modalCtx = buildAppModalsContext({
    bookmarkAllPrefix, bookmarkTitle, browserListing, browserPathInput,
    chooseExportPngOutputNative, chooseExtractOutputNative, chooseInsertPdfNative, chooseMarkdownSaveAsNative,
    chooseMergePdfNative, chooseOpenPdfNative, chooseSaveAsNative, chooseSignCertNative,
    closePageTextModal, closePasswordModal, closeSearchModal, closeTesseractReminderModal,
    commitBrowserPath, confirmAddFormField, confirmImageSource, cropApplyAll,
    cropMarginBottom, cropMarginLeft, cropMarginRight, cropMarginTop,
    cropRange, currentPage, decryptPassword, defaultExtractOutputPath,
    expandMarginBottom, expandMarginLeft, expandMarginRight, expandMarginTop,
    defaultImageExportOutput, deleteNthValue, deletePageInput, deleteRange,
    duplicateRange, editingTextIndex, exitNoteMode, expandMarginsRange,
    exportPagePdfPath, exportPagesPdfOutputDir, exportPagesPdfRange, extractEvenOutputPath,
    extractOddOutputPath, extractOutputPath, extractRange, fileNameFromPath,
    flattenRange, handleAddBookmark, handleAddPageBorder, handleAddPageBorderEvenPages,
    handleAddPageBorderOddPages, handleAddPageFooter, handleAddPageFooterEvenPages, handleAddPageFooterOddPages,
    handleAddPageHeader, handleAddPageHeaderEvenPages, handleAddPageHeaderOddPages, handleAddPageNumbers,
    handleAddPageNumbersEvenPages, handleAddPageNumbersOddPages, handleAddWatermark, handleAddWatermarkEvenPages,
    handleAddWatermarkOddPages, handleBookmarkAllPages, handleBookmarkEvenPages, handleBookmarkOddPages,
    handleBrowserEntryClick, handleClearAllCrops, handleClearCropEvenPages, handleClearCropOddPages,
    handleClearPageCrop, handleClearPdfMetadata, handleCopySummary, handleCropEvenPages,
    handleCropOddPages, handleCropPage, handleCropPageRange, handleDeleteEveryNthPage,
    handleDeletePage, handleDeletePageRange, handleDuplicatePageRange, handleDuplicatePageRangeBefore,
    handleDuplicatePageRangeToEnd, handleDuplicatePageRangeToStart, handleExpandEvenPages, handleExpandOddPages,
    handleExpandPageMargins, handleExportEvenPagesAsPdf, handleExportEvenPagesImage, handleExportOddPagesAsPdf,
    handleExportOddPagesImage, handleExportPagePdf, handleExportPagesPdf, handleExportPng,
    handleExtractEvenPages, handleExtractOddPages, handleExtractPdf, handleFlattenAnnotations,
    handleInsertBlankPages, handleInsertImagePage, handleInsertPdf, handleInterleavePdf,
    handleInterleaveSourcePathChange, handleKeepPageRange, handleMarkdownSaveAs, handleMergePdf,
    handleMovePageRange, handleMovePageRangeToEnd, handleMovePageRangeToStart, handleOpenEncryptedPdf,
    handleOpenPdfPath, handleOpenRecentPdf, handleParityRangeAction, handlePrependPdf,
    handlePrependSourcePathChange, handleProtectPdf, handleRemovePdfPassword, handleRenameBookmark,
    handleReplacePage, handleReplaceSourcePathChange, handleResetRotationRange, handleReversePageRange,
    handleRotatePage180Range, handleRotatePageRange, handleSaveAs, handleSaveMetadata,
    handleSaveSummary, handleSetPageSize, handleSetPageSizeEvenPages, handleSetPageSizeOddPages,
    handleShrinkEvenPages, handleShrinkOddPages, handleShrinkPageMargins, handleSignPdf,
    handleSplitEveryN, handleSplitPdf, handleSplitPdfAtPage, handleSwapPages,
    imageExportFormat, imageSourceDraft, insertAtPage, insertBlankAtIndex,
    insertBlankCount, insertFilePath, insertImageAtIndex, insertImagePagePath,
    insertRange, insertSourcePageCount, interleaveFilePath, interleaveRange,
    interleaveSourcePageCount, keepRange, loadPdfBrowser, markdownSaveAsPath,
    mergeFilePath, mergeRange, mergeSourcePageCount, metadataAuthor,
    metadataCreationDate, metadataCreator, metadataKeywords, metadataModDate,
    metadataProducer, metadataSubject, metadataTitle, moveRange,
    moveRangeToIndex, nativeDialogs, newFormCheckboxChecked, newFormFieldKind,
    newFormFieldName, newFormFieldOptions, newFormRadioGroup, newFormRadioOption,
    noteDraft, openFilePath, openPdfBrowser, pageBorderInset,
    pageBorderRange, pageCount, pageFooterRange, pageFooterText,
    pageHeaderRange, pageHeaderText, pageNumbersPrefix, pageNumbersRange,
    pageSizePreset, pageSizeRange, pageTextDraft, pageTextEdits,
    pageTextFontSize, pageVectorEdits, parityRange, parityRangeCommand,
    parityRangeOutputPath, pdfPasswordDraft, pdfSummary, pngExportOutputPath,
    pngExportRange, prependFilePath, prependRange, prependSourcePageCount,
    protectOwnerPassword, protectUserPassword, protectUserPasswordConfirm, recentPdfs,
    removePageTextEdit, removePageVectorEdit, renameBookmarkTitle, replaceSourcePage,
    replaceSourcePageCount, replaceSourcePath, resolveUnsaved, reverseRange,
    rotateRange, runPdfSearch, saveAsPath, searchInputRef,
    searchMatchCase, searchQuery, searchResultIndex, searchResults,
    searchWholeWord, setBookmarkAllPrefix, setBookmarkTitle, setBrowserPathInput,
    setCropApplyAll, setCropMarginBottom, setCropMarginLeft, setCropMarginRight,
    setCropMarginTop, setDecryptPassword, setDeleteNthValue, setDeletePageInput,
    setExpandMarginBottom, setExpandMarginLeft, setExpandMarginRight,
    setExpandMarginTop, setExportPagePdfPath, setExportPagesPdfOutputDir, setExtractEvenOutputPath,
    setExtractOddOutputPath, setExtractOutputPath, setImageExportFormat, setImageSourceDraft,
    setInsertAtPage, setInsertBlankAtIndex, setInsertBlankCount, setInsertFilePath,
    setInsertImageAtIndex, setInsertImagePagePath, setMarkdownSaveAsPath, setMergeFilePath,
    setMetadataAuthor, setMetadataCreator, setMetadataKeywords, setMetadataProducer,
    setMetadataSubject, setMetadataTitle, setMoveRangeToIndex, setNewFormCheckboxChecked,
    setNewFormFieldKind, setNewFormFieldName, setNewFormFieldOptions, setNewFormRadioGroup,
    setNewFormRadioOption, setNoteDraft, setOpenFilePath, setPageBorderInset,
    setPageFooterText, setPageHeaderText, setPageNumbersPrefix, setPageSizePreset,
    setPageTextDraft, setPageTextFontSize, setParityRangeCommand, setParityRangeOutputPath,
    setPdfPasswordDraft, setPngExportOutputPath, setProtectOwnerPassword, setProtectUserPassword,
    setProtectUserPasswordConfirm, setRenameBookmarkTitle, setReplaceSourcePage, setSaveAsPath,
    setSearchMatchCase, setSearchQuery, setSearchWholeWord, setShowAddBookmarkModal,
    setShowAddFormFieldModal, setShowBookmarkAllModal, setShowBrowserModal, setShowCropModal,
    setShowCropRangeModal, setShowDecryptModal, setShowDeleteModal, setShowDeleteNthModal,
    setShowDeleteRangeModal, setShowDuplicateRangeModal, setShowExpandMarginsModal, setShowExportPagePdfModal,
    setShowExportPagesPdfModal, setShowExportPngModal, setShowExtractEvenModal, setShowExtractModal,
    setShowExtractOddModal, setShowFlattenModal, setShowImageInsertModal, setShowInsertBlankPagesModal,
    setShowInsertImagePageModal, setShowInsertModal, setShowInterleaveModal, setShowKeepRangeModal,
    setShowMarkdownSaveAsModal, setShowMergeModal, setShowMetadataModal, setShowMoveRangeModal,
    setShowOpenModal, setShowPageBorderModal, setShowPageEditsModal, setShowPageFooterModal,
    setShowPageHeaderModal, setShowPageNumbersModal, setShowPageSizeModal, setShowParityRangeModal,
    setShowPrependModal, setShowProtectModal, setShowRenameBookmarkModal, setShowReplacePageModal,
    setShowReverseRangeModal, setShowRotateRangeModal, setShowSaveAsModal, setShowShrinkMarginsModal,
    setShowSignModal, setShowSplitAtModal, setShowSplitEveryModal, setShowSplitModal,
    setShowSummaryModal, setShowSwapPagesModal, setShowWatermarkModal, setShrinkMarginBottom,
    setShrinkMarginLeft, setShrinkMarginRight, setShrinkMarginTop, setSignCertPassword,
    setSignCertPath, setSignLocation, setSignReason, setSplitAtPage,
    setSplitEveryN, setSplitRanges, setSwapPageA,
    setSwapPageB, setTesseractDoNotRemind, setWatermarkText, showAddBookmarkModal,
    showAddFormFieldModal, showBookmarkAllModal, showBrowserModal, showCropModal,
    showCropRangeModal, showDecryptModal, showDeleteModal, showDeleteNthModal,
    showDeleteRangeModal, showDuplicateRangeModal, showExpandMarginsModal, showExportPagePdfModal,
    showExportPagesPdfModal, showExportPngModal, showExtractEvenModal, showExtractModal,
    showExtractOddModal, showFlattenModal, showImageInsertModal, showInsertBlankPagesModal,
    showInsertImagePageModal, showInsertModal, showInterleaveModal, showKeepRangeModal,
    showMarkdownSaveAsModal, showMergeModal, showMetadataModal, showMoveRangeModal,
    showNoteModal, showOpenModal, showPageBorderModal, showPageEditsModal,
    showPageFooterModal, showPageHeaderModal, showPageNumbersModal, showPageSizeModal,
    showPageTextModal, showParityRangeModal, showPasswordModal, showPrependModal,
    showProtectModal, showRenameBookmarkModal, showReplacePageModal, showReverseRangeModal,
    showRotateRangeModal, showSaveAsModal, showSearchModal, showShrinkMarginsModal,
    showSignModal, showSplitAtModal, showSplitEveryModal, showSplitModal,
    showSummaryModal, showSwapPagesModal, showTesseractModal, showToast,
    showUnsavedModal, showWatermarkModal, shrinkMarginBottom, shrinkMarginLeft,
    shrinkMarginRight, shrinkMarginTop, shrinkMarginsRange, signCertPassword,
    signCertPath, signLocation, signReason, splitAtPage,
    splitEveryN, splitRanges, startEditPageText, stepSearchMatch,
    submitPageText, submitTextNote, swapPageA, swapPageB,
    tesseractDoNotRemind, tesseractInstallGuide, watermarkRange, watermarkText,
    pageSizes,
  });


  return (
    <AppShell
      windowTitle={windowTitle}
      toast={toast}
      loading={loading}
      chrome={buildChromeContext({
        menus: appMenus,
        showCommandPalette,
        showShortcutsHelp,
        showLicenses,
        showCredits,
        showAbout,
        onCloseCommandPalette: () => setShowCommandPalette(false),
        onCloseShortcutsHelp: () => setShowShortcutsHelp(false),
        onCloseLicenses: () => setShowLicenses(false),
        onCloseCredits: () => setShowCredits(false),
        onCloseAbout: () => setShowAbout(false),
        modeExtras: modeToolbarExtras,
        showPageControls: pageCount !== null && viewMode === 'pdf',
        pageControls: pageCount !== null && viewMode === 'pdf' ? {
          pageCount,
          currentPage,
          pageInput,
          pageSizes,
          onPageInputChange: setPageInput,
          onCommitPage: commitPage,
          onGoToPage: goToPage,
          zoom,
          zoomInput,
          onZoomInputChange: setZoomInput,
          onCommitZoom: commitZoom,
          onZoomIn: zoomIn,
          onZoomOut: zoomOut,
          onResetZoom: resetZoom,
        } : null,
      })}
      body={buildViewerContext({
        filePath,
        sidebar: {
          filePath,
          thumbnails,
          currentPage,
          draggedIndex,
          onDragStart: handleDragStart,
          onDragOver: handleDragOver,
          onDrop: handleDrop,
          onGoToPage: goToPage,
          showBookmarksPanel,
          pdfBookmarks,
          onOpenAddBookmarkModal: openAddBookmarkModal,
          onOpenBookmarkAllModal: openBookmarkAllModal,
          onClearAllBookmarks: handleClearAllBookmarks,
          onReloadBookmarks: loadPdfBookmarks,
          onOpenRenameBookmarkModal: openRenameBookmarkModal,
          onRemoveBookmark: handleRemoveBookmark,
          showSignaturesPanel,
          pdfSignatures,
          signatureVerification,
          onReloadSignatures: loadPdfSignatures,
          showFormsPanel,
          formFields,
          formDrafts,
          onFormDraftsChange: setFormDrafts,
          onOpenAddFormFieldModal: openAddFormFieldModal,
          onApplyFormField: applyFormField,
        },
        viewer: {
          viewMode,
          scrollRef,
          onWheel: handleWheel,
          onOpenPdf: openPdf,
          markdownOcrNotice,
          markdownPath,
          markdownText,
          onOpenMarkdownSaveAs: openMarkdownSaveAs,
          pdfPage: {
            zoom,
            imageSrc,
            imgRef,
            onImageLoad: handleImageLoad,
            highlightMode,
            noteMode,
            drawMode,
            shapeMode,
            stampMode,
            redactMode,
            imageInsertMode,
            textEditMode,
            vectorEditMode,
            formAddMode,
            onPageClick: handlePageClick,
            onMouseDown: handleDrawMouseDown,
            onMouseMove: handlePageMouseMove,
            onMouseUp: handleDrawMouseUp,
            activeSearchRect,
            annotations,
            shapeKind,
            drawing,
            highlightStart,
            highlightRect,
            shapeLineEnd,
            inkDraft,
            pageTextEdits,
            pageVectorEdits,
            showFormsPanel,
            formFields,
            currentPage,
            onRemoveHighlight: removeHighlight,
            onRemoveRedaction: removeRedaction,
            onRemoveStamp: removeStamp,
            onRemoveShape: removeShape,
            onRemoveInkStroke: removeInkStroke,
            onRemoveTextNote: removeTextNote,
          },
        },
      })}
      modals={{ ctx: modalCtx }}
      printPages={printPages}
    />
  );
}

export default App;
