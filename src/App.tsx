import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog';
import { TitleBar } from './chrome/TitleBar';
import { buildAppMenus } from './menu/buildAppMenus';
import { buildAppMenuContext } from './menu/buildAppMenuContext';
import { MenuChrome } from './menu/MenuChrome';
import { useStructuralEdit } from './pdf/useStructuralEdit';
import { Toast } from './ui/Toast';
import { usePageRange, usePageRangePair } from './pageRange/usePageRange';
import {
  type ImageExportFormat,
  imageExportCommand,
  imageExportExtension,
  imageExportLabel,
  parityImageExportCommand,
} from './pdf/imageExportCommands';
import {
  buildParityBatchPayload,
  parityBatchMutatesPdf,
  parityBatchNeedsRange,
} from './pdf/parityPayload';
import { useUndoHistory } from './pdf/useUndoHistory';
import { usePdfDocument } from './pdf/usePdfDocument';
import { type FormFieldKind } from './modals/AddFormFieldModal';
import { type PdfBrowserEntry, type PdfBrowserListing } from './modals/PdfBrowserModal';
import { type PageSizePreset } from './modals/PageSizeModal';
import { type PdfTextSearchMatch } from './modals/SearchModal';
import { type TesseractInstallGuide } from './modals/TesseractReminderModal';
import { type UnsavedChoice } from './modals/UnsavedChangesModal';
import { AppModals } from './modals/AppModals';
import { buildAppModalsContext } from './modals/appModalsContext';
import { AppBody } from './viewer/AppBody';
import { ModeToolbarExtras } from './viewer/ModeToolbarExtras';
import { PageControls } from './viewer/PageControls';
import {
  BMP_DIALOG_FILTER,
  CERT_DIALOG_FILTER,
  DEFAULT_TESSERACT_GUIDE,
  GIF_DIALOG_FILTER,
  JPEG_DIALOG_FILTER,
  MARKDOWN_DIALOG_FILTER,
  PDF_DIALOG_FILTER,
  PNG_DIALOG_FILTER,
  PPM_DIALOG_FILTER,
  RECENT_PDF_LIMIT,
  RECENT_PDFS_KEY,
  LAST_BROWSER_DIR_KEY,
  TIFF_DIALOG_FILTER,
  WEBP_DIALOG_FILTER,
  WHEEL_NAV_COOLDOWN,
  ZOOM_STEP,
  type ShapeKind,
  type StampKind,
  STAMP_PRESETS,
} from './app/constants';
import {
  type AnnotationData,
  type FormFieldData,
  type MarkdownOcrNotice,
  type MarkdownSaveResult,
  type PageTextEdit,
  type PageVectorEdit,
  type PdfBookmarkEntry,
  type PdfBrowserTarget,
  type PdfDocumentMetadata,
  type PdfPageSize,
  type PdfSignatureInfo,
  type PdfSignatureVerificationSummary,
  type PdfSummaryResult,
  type PngExportScope,
  type SummarySaveResult,
  type ViewMode,
} from './app/types';
import {
  clampZoom,
  directoryFromPath,
  dismissTesseractReminder,
  ensureExtension,
  fileNameFromPath,
  formatSummaryMarkdown,
  isTesseractReminderDismissed,
  markdownOcrNoticeFromResult,
  markdownSaveToastMessage,
  pickPdfWithNativeDialog,
  pickSaveWithNativeDialog,
  readStoredString,
  readStoredStringArray,
  siblingMarkdownPath,
  writeStoredString,
  writeStoredStringArray,
} from './app/utils';
import { runAnnotationRemoveViaEdit, type AnnotationRemoveCommand } from './pdf/runAnnotationEdit';

function App() {
  const [filePath, setFilePath] = useState<string>(''); // working-copy path; all backend ops target this
  const [originalPath, setOriginalPath] = useState<string>(''); // user's real file (display / recents / Save target)
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const isDirtyRef = useRef(false);
  const pendingNavRef = useRef<null | (() => void | Promise<void>)>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
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
  const [highlightStart, setHighlightStart] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [inkDrawing, setInkDrawing] = useState(false);
  const [inkDraft, setInkDraft] = useState<number[]>([]);
  const [shapeLineEnd, setShapeLineEnd] = useState<{ x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const cancelDrawingRef = useRef<() => void>(() => {});
  const loadPdfBookmarksRef = useRef<(path: string) => void>(() => {});
  const loadPageSizesRef = useRef<(path: string) => void>(() => {});

  // Scrolling / wheel navigation
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<'top' | 'bottom' | null>(null);
  const lastWheelNavRef = useRef(0);

  // Print
  const [printPages, setPrintPages] = useState<string[]>([]);

  // Modals
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string>('');
  const [recentPdfs, setRecentPdfs] = useState<string[]>(() => readStoredStringArray(RECENT_PDFS_KEY));
  const [lastBrowserDir, setLastBrowserDir] = useState<string>(() => readStoredString(LAST_BROWSER_DIR_KEY));
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<PdfBrowserTarget>('open');
  const [browserListing, setBrowserListing] = useState<PdfBrowserListing | null>(null);
  const [browserPathInput, setBrowserPathInput] = useState('');
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
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchResults, setSearchResults] = useState<PdfTextSearchMatch[]>([]);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [activeSearchRect, setActiveSearchRect] = useState<[number, number, number, number] | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    void (async () => {
      const [dialogs, available, guide] = await Promise.all([
        invoke<boolean>('native_file_dialogs_enabled').catch(() => false),
        invoke<boolean>('ocr_available').catch(() => true),
        invoke<TesseractInstallGuide>('tesseract_install_guide').catch(() => null),
      ]);
      setNativeDialogs(dialogs);
      setOcrAvailable(available);
      setTesseractInstallGuide(guide ?? DEFAULT_TESSERACT_GUIDE);
      if (!available && !isTesseractReminderDismissed()) {
        setTesseractReminderSource('launch');
        setShowTesseractModal(true);
      }
    })();
  }, []);

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

  const rememberOpenedPdf = useCallback((path: string) => {
    rememberBrowserDirectory(path);
    setRecentPdfs((prev) => {
      const next = [path, ...prev.filter((item) => item !== path)].slice(0, RECENT_PDF_LIMIT);
      writeStoredStringArray(RECENT_PDFS_KEY, next);
      return next;
    });
  }, [rememberBrowserDirectory]);

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

  const loadPdfFromPath = async (path: string, password?: string) => {
    const loaded = await withLoading(async () => {
      const encrypted = await invoke<boolean>('pdf_is_encrypted', { path });
      if (encrypted && !password) {
        setPendingEncryptedPath(path);
        setPdfPasswordDraft('');
        setShowPasswordModal(true);
        return false;
      }
      const previousWorking = filePath;
      const working = password
        ? await invoke<string>('open_working_copy_with_password', { original: path, password })
        : await invoke<string>('open_working_copy', { original: path });
      const count = await invoke<number>('get_pdf_page_count', { path: working });
      setOriginalPath(path);
      setFilePath(working);
      await resetHistoryForOpen(working);
      setViewMode('pdf');
      setMarkdownText('');
      setMarkdownPath('');
      setMarkdownOcrNotice(null);
      setPdfRevision(0);
      setMarkdownRevision(null);
      cancelDrawing();
      setPageCount(count);
      setCurrentPage(0);
      setZoom(1);
      await renderPage(working, 0);
      await loadThumbnails(working);
      await loadFormFields(working);
      rememberOpenedPdf(path);
      if (previousWorking) void invoke('discard_working_copy', { working: previousWorking }).catch(() => {});
      return true;
    });
    return loaded === true;
  };

  const openPdf = () => guardUnsaved(() => {
    setOpenFilePath(originalPath);
    setShowOpenModal(true);
  });

  const handleOpenPdfPath = async () => {
    const path = openFilePath.trim();
    if (!path) return;
    const loaded = await loadPdfFromPath(path);
    if (loaded) setShowOpenModal(false);
  };

  const handleOpenEncryptedPdf = async () => {
    const path = pendingEncryptedPath.trim();
    const password = pdfPasswordDraft;
    if (!path || !password) return;
    try {
      await invoke('verify_pdf_password', { path, password });
    } catch {
      showToast('Incorrect password', 'error');
      return;
    }
    const loaded = await loadPdfFromPath(path, password);
    if (loaded) {
      setShowPasswordModal(false);
      setShowOpenModal(false);
      setPendingEncryptedPath('');
      setPdfPasswordDraft('');
    }
  };

  const handleOpenRecentPdf = async (path: string) => {
    setOpenFilePath(path);
    const loaded = await loadPdfFromPath(path);
    if (loaded) setShowOpenModal(false);
  };

  const loadPdfBrowser = async (path?: string) => {
    await withLoading(async () => {
      const listing = await invoke<PdfBrowserListing>('list_pdf_browser_entries', {
        path: path && path.trim() ? path.trim() : null,
      });
      setBrowserListing(listing);
      setBrowserPathInput(listing.currentDir);
    });
  };

  const openPdfBrowser = (target: PdfBrowserTarget) => {
    setBrowserTarget(target);
    setShowBrowserModal(true);
    const sourcePath = target === 'insert'
      ? insertFilePath
      : target === 'replace'
        ? replaceSourcePath
        : target === 'interleave'
          ? interleaveFilePath
          : target === 'prepend'
            ? prependFilePath
            : mergeFilePath;
    const startPath = target === 'open'
      ? lastBrowserDir || directoryFromPath(openFilePath) || directoryFromPath(originalPath)
      : directoryFromPath(sourcePath) || lastBrowserDir || directoryFromPath(originalPath);
    void loadPdfBrowser(startPath);
  };

  const commitBrowserPath = () => {
    void loadPdfBrowser(browserPathInput);
  };

  const handleBrowserEntryClick = async (entry: PdfBrowserEntry) => {
    if (entry.isDir) {
      await loadPdfBrowser(entry.path);
      return;
    }

    if (browserTarget === 'open') {
      setOpenFilePath(entry.path);
      const loaded = await loadPdfFromPath(entry.path);
      if (!loaded) return;
      setShowOpenModal(false);
    } else if (browserTarget === 'insert') {
      setInsertFilePath(entry.path);
      rememberBrowserDirectory(entry.path);
    } else if (browserTarget === 'replace') {
      setReplaceSourcePath(entry.path);
      rememberBrowserDirectory(entry.path);
      void invoke<number>('get_pdf_page_count', { path: entry.path }).then((count) => {
        setReplaceSourcePageCount(count);
        setReplaceSourcePage(0);
      });
    } else if (browserTarget === 'interleave') {
      setInterleaveFilePath(entry.path);
      rememberBrowserDirectory(entry.path);
      void invoke<number>('get_pdf_page_count', { path: entry.path }).then((count) => {
        setInterleaveSourcePageCount(count);
        interleaveRange.reset(0, Math.max(0, count - 1));
      });
    } else if (browserTarget === 'prepend') {
      setPrependFilePath(entry.path);
      rememberBrowserDirectory(entry.path);
      void invoke<number>('get_pdf_page_count', { path: entry.path }).then((count) => {
        setPrependSourcePageCount(count);
        prependRange.reset(0, Math.max(0, count - 1));
      });
    } else {
      setMergeFilePath(entry.path);
      rememberBrowserDirectory(entry.path);
    }
    setShowBrowserModal(false);
  };

  const handleDragStart = (idx: number) => setDraggedIndex(idx);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== targetIdx) {
      await withLoading(async () => {
        await invoke('move_page', { path: filePath, fromIndex: draggedIndex, toIndex: targetIdx });
        markPdfEdited();
        await loadThumbnails(filePath);
        setDraggedIndex(null);
        setCurrentPage(targetIdx);
        await renderPage(filePath, targetIdx);
      });
    }
  };

  const openDeleteModal = () => {
    if (!filePath || pageCount === null) return;
    setDeletePageInput(String(currentPage + 1));
    setShowDeleteModal(true);
  };

  const openInsertModal = () => {
    if (!filePath) return;
    setShowInsertModal(true);
  };

  const openSplitModal = () => {
    if (!filePath) return;
    setShowSplitModal(true);
  };

  const defaultExtractOutputPath = (start: number, end: number) => {
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    return `${base}_pages_${start + 1}-${end + 1}.pdf`;
  };

  const openExtractModal = () => {
    if (!filePath || pageCount === null) return;
    extractRange.reset(currentPage, currentPage);
    setExtractOutputPath(defaultExtractOutputPath(currentPage, currentPage));
    setShowExtractModal(true);
  };


  const defaultImageExportOutput = (format: ImageExportFormat, scope: PngExportScope, start: number, _end: number) => {
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    const ext = imageExportExtension(format);
    if (scope === 'current') return `${base}_page_${start + 1}.${ext}`;
    return `${base}_pages`;
  };

  const openExportPngModal = () => {
    if (!filePath || pageCount === null) return;
    pngExportRange.reset({ scope: 'current', start: currentPage, end: currentPage });
    setPngExportOutputPath(defaultImageExportOutput(imageExportFormat, 'current', currentPage, currentPage));
    setShowExportPngModal(true);
  };

  const handleExportPng = async () => {
    const output = pngExportOutputPath.trim();
    if (!filePath || !output) return;
    const range = pngExportRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    const ext = imageExportExtension(imageExportFormat);
    const label = imageExportLabel(imageExportFormat);
    await withLoading(async () => {
      if (pngExportRange.scope === 'current') {
        const written = await invoke<string>(imageExportCommand(imageExportFormat, false), {
          path: filePath,
          pageIndex: currentPage,
          outputPath: ensureExtension(output, ext),
        });
        showToast(`Exported ${label} to ${written}`);
      } else {
        const written = await invoke<string[]>(imageExportCommand(imageExportFormat, true), {
          path: filePath,
          startPage: start,
          endPage: end,
          outputDir: output,
        });
        showToast(`Exported ${written.length} ${label} file${written.length === 1 ? '' : 's'} to ${output}`);
      }
      setShowExportPngModal(false);
    });
  };

  const chooseExportPngOutputNative = async () => {
    const ext = imageExportExtension(imageExportFormat);
    const filters = imageExportFormat === 'jpeg'
      ? JPEG_DIALOG_FILTER
      : imageExportFormat === 'webp'
        ? WEBP_DIALOG_FILTER
        : imageExportFormat === 'bmp'
          ? BMP_DIALOG_FILTER
          : imageExportFormat === 'tiff'
            ? TIFF_DIALOG_FILTER
            : imageExportFormat === 'gif'
              ? GIF_DIALOG_FILTER
              : imageExportFormat === 'ppm'
                ? PPM_DIALOG_FILTER
                : PNG_DIALOG_FILTER;
    if (pngExportRange.scope === 'current') {
      const picked = await pickSaveWithNativeDialog(
        ensureExtension(
          pngExportOutputPath || defaultImageExportOutput(imageExportFormat, 'current', currentPage, currentPage),
          ext,
        ),
        filters,
      );
      if (!picked) return;
      setPngExportOutputPath(ensureExtension(picked, ext));
      return;
    }
    const picked = await pickSaveWithNativeDialog(
      pngExportOutputPath || defaultImageExportOutput(imageExportFormat, pngExportRange.scope, pngExportRange.startPage, pngExportRange.endPage),
      filters,
    );
    if (!picked) return;
    setPngExportOutputPath(picked.replace(/\.(png|jpe?g|webp|bmp)$/i, ''));
  };

  const loadPageSizes = useCallback(async (path: string = filePath) => {
    if (!path) {
      setPageSizes([]);
      return;
    }
    try {
      const sizes = await invoke<PdfPageSize[]>('get_pdf_page_sizes', { path });
      setPageSizes(sizes);
    } catch {
      setPageSizes([]);
    }
  }, [filePath]);
  loadPageSizesRef.current = (path) => { void loadPageSizes(path); };

  const runEdit = useStructuralEdit({
    filePath,
    currentPage,
    withLoading,
    markPdfEdited,
    reloadOpenPdf,
    showToast,
  });

  const handleRotatePageCcw = async () => {
    await runEdit({ command: 'rotate_page_ccw', args: { pageIndex: currentPage }, toast: 'Page rotated 90° counter-clockwise' });
  };

  const handleResetPageRotation = async () => {
    await runEdit({ command: 'reset_page_rotation', args: { pageIndex: currentPage }, toast: 'Page rotation reset' });
  };

  const handleResetAllRotations = async () => {
    await runEdit({ command: 'reset_all_page_rotations', toast: (n) => `Reset rotation on ${n} page${n === 1 ? '' : 's'}` });
  };

  const openDuplicateRangeModal = () => {
    if (!filePath || pageCount === null) return;
    duplicateRange.reset(currentPage, currentPage);
    setShowDuplicateRangeModal(true);
  };

  const handleDuplicatePageRange = async () => {
    if (!filePath) return;
    const range = duplicateRange.validate();
    if (!range) return;
    await runEdit({ command: 'duplicate_page_range', args: { startPage: duplicateRange.startPage, endPage: duplicateRange.endPage }, reloadAt: duplicateRange.endPage + 1, toast: (n) => `Duplicated ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowDuplicateRangeModal(false) });
  };

  const handleDuplicatePageRangeToEnd = async () => {
    if (!filePath || pageCount === null) return;
    const range = duplicateRange.validate();
    if (!range) return;
    await runEdit<number>({
      command: 'duplicate_page_range_to_end',
      args: { startPage: duplicateRange.startPage, endPage: duplicateRange.endPage },
      reloadAt: (count) => pageCount + count - 1,
      toast: (count) => `Appended ${count} page${count === 1 ? '' : 's'} to end`,
      onSuccess: () => setShowDuplicateRangeModal(false),
    });
  };

  const handleDuplicatePageRangeToStart = async () => {
    if (!filePath) return;
    const range = duplicateRange.validate();
    if (!range) return;
    await runEdit({ command: 'duplicate_page_range_to_start', args: { startPage: duplicateRange.startPage, endPage: duplicateRange.endPage }, reloadAt: 0, toast: (n) => `Inserted ${n} page${n === 1 ? '' : 's'} at start`, onSuccess: () => setShowDuplicateRangeModal(false) });
  };

  const handleDuplicatePageRangeBefore = async () => {
    if (!filePath) return;
    const range = duplicateRange.validate();
    if (!range) return;
    await runEdit({ command: 'duplicate_page_range_before', args: { startPage: duplicateRange.startPage, endPage: duplicateRange.endPage }, reloadAt: duplicateRange.startPage, toast: (n) => `Inserted ${n} page${n === 1 ? '' : 's'} before range`, onSuccess: () => setShowDuplicateRangeModal(false) });
  };

  const handleReversePages = async () => {
    if (!filePath || pageCount === null) return;
    await runEdit({ command: 'reverse_pages', reloadAt: pageCount - 1 - currentPage, toast: 'Page order reversed' });
  };

  const handleRotateAllPages = async () => {
    await runEdit({ command: 'rotate_all_pages', toast: (n) => `Rotated ${n} page${n === 1 ? '' : 's'} 90°` });
  };

  const handleAddBlankPage = async () => {
    await runEdit<number>({
      command: 'add_blank_page',
      args: { atIndex: currentPage + 1 },
      reloadAt: (newIndex) => newIndex,
      toast: (newIndex) => `Blank page inserted at position ${newIndex + 1}`,
    });
  };

  const handleAddBlankPageBefore = async () => {
    await runEdit<number>({
      command: 'add_blank_page',
      args: { atIndex: currentPage },
      reloadAt: (newIndex) => newIndex,
      toast: () => `Blank page inserted before page ${currentPage + 1}`,
    });
  };

  const handleRotatePage180 = async () => {
    await runEdit({ command: 'rotate_page_180', args: { pageIndex: currentPage }, toast: 'Page rotated 180°' });
  };

  const handleRotateAllPagesCcw = async () => {
    await runEdit({ command: 'rotate_all_pages_ccw', toast: (n) => `Rotated ${n} page${n === 1 ? '' : 's'} CCW` });
  };

  const handleMovePageToFirst = async () => {
    if (!filePath || currentPage === 0) return;
    await runEdit({ command: 'move_page_to_first', args: { pageIndex: currentPage }, reloadAt: 0, toast: 'Page moved to first position' });
  };

  const handleMovePageToLast = async () => {
    if (!filePath || pageCount === null || currentPage >= pageCount - 1) return;
    await runEdit({
      command: 'move_page_to_last',
      args: { pageIndex: currentPage },
      reloadAt: () => (pageCount ?? 1) - 1,
      toast: 'Page moved to last position',
    });
  };

  const handleClearAllCrops = async () => {
    await runEdit({ command: 'clear_all_page_crops', toast: (n) => `Cleared crop on ${n} page${n === 1 ? '' : 's'}` });
  };

  const handleClearAllBookmarks = async () => {
    await runEdit({
      command: 'clear_pdf_bookmarks',
      afterEdit: async () => { await loadPdfBookmarks(filePath); },
      toast: (n) => `Removed ${n} bookmark${n === 1 ? '' : 's'}`,
    });
  };

  const openPageHeaderModal = () => {
    if (!filePath || pageCount === null) return;
    pageHeaderRange.reset();
    setPageHeaderText('DRAFT');
    setShowPageHeaderModal(true);
  };

  const handleAddPageHeader = async () => {
    if (!filePath || !pageHeaderText.trim()) return;
    const range = pageHeaderRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'add_page_header', args: { startPage: start, endPage: end, text: pageHeaderText.trim() }, toast: (n) => `Added header to ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageHeaderModal(false) });
  };

  const handleAddPageHeaderOddPages = async () => {
    if (!filePath || !pageHeaderText.trim()) return;
    await runEdit({ command: 'add_page_header_odd_pages', args: { text: pageHeaderText.trim() }, toast: (n) => `Added header to ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageHeaderModal(false) });
  };

  const handleAddPageHeaderEvenPages = async () => {
    if (!filePath || !pageHeaderText.trim()) return;
    await runEdit({ command: 'add_page_header_even_pages', args: { text: pageHeaderText.trim() }, toast: (n) => `Added header to ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageHeaderModal(false) });
  };

  const openPageFooterModal = () => {
    if (!filePath || pageCount === null) return;
    pageFooterRange.reset();
    setPageFooterText('Confidential');
    setShowPageFooterModal(true);
  };

  const handleAddPageFooter = async () => {
    if (!filePath || !pageFooterText.trim()) return;
    const range = pageFooterRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'add_page_footer', args: { startPage: start, endPage: end, text: pageFooterText.trim() }, toast: (n) => `Added footer to ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageFooterModal(false) });
  };

  const handleAddPageFooterOddPages = async () => {
    if (!filePath || !pageFooterText.trim()) return;
    await runEdit({ command: 'add_page_footer_odd_pages', args: { text: pageFooterText.trim() }, toast: (n) => `Added footer to ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageFooterModal(false) });
  };

  const handleAddPageFooterEvenPages = async () => {
    if (!filePath || !pageFooterText.trim()) return;
    await runEdit({ command: 'add_page_footer_even_pages', args: { text: pageFooterText.trim() }, toast: (n) => `Added footer to ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageFooterModal(false) });
  };

  const openSwapPagesModal = () => {
    if (!filePath || pageCount === null) return;
    setSwapPageA(currentPage);
    setSwapPageB(Math.min(currentPage + 1, pageCount - 1));
    setShowSwapPagesModal(true);
  };

  const handleSwapPages = async () => {
    if (!filePath || pageCount === null) return;
    if (swapPageA === swapPageB) {
      showToast('Choose two different pages', 'error');
      return;
    }
    await runEdit({
      command: 'swap_pages',
      args: { pageIndexA: swapPageA, pageIndexB: swapPageB },
      reloadAt: swapPageA === currentPage ? swapPageB : swapPageB === currentPage ? swapPageA : currentPage,
      toast: `Swapped pages ${swapPageA + 1} and ${swapPageB + 1}`,
      onSuccess: () => setShowSwapPagesModal(false),
    });
  };

  const handleMovePageUp = async () => {
    if (!filePath || currentPage === 0) return;
    await runEdit({ command: 'move_page_up', args: { pageIndex: currentPage }, reloadAt: currentPage - 1, toast: `Moved page ${currentPage + 1} up` });
  };

  const handleMovePageDown = async () => {
    if (!filePath || pageCount === null || currentPage >= pageCount - 1) return;
    await runEdit({ command: 'move_page_down', args: { pageIndex: currentPage }, reloadAt: currentPage + 1, toast: `Moved page ${currentPage + 1} down` });
  };

  const openReplacePageModal = () => {
    if (!filePath) return;
    setReplaceSourcePath('');
    setReplaceSourcePage(currentPage);
    setReplaceSourcePageCount(null);
    setShowReplacePageModal(true);
  };

  const handleReplaceSourcePathChange = async (value: string) => {
    setReplaceSourcePath(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setReplaceSourcePageCount(null);
      return;
    }
    try {
      const count = await invoke<number>('get_pdf_page_count', { path: trimmed });
      setReplaceSourcePageCount(count);
      setReplaceSourcePage((prev) => Math.min(prev, Math.max(0, count - 1)));
    } catch {
      setReplaceSourcePageCount(null);
    }
  };

  const handleReplacePage = async () => {
    const source = replaceSourcePath.trim();
    if (!filePath || !source) return;
    await runEdit({ command: 'replace_page', args: { pageIndex: currentPage, sourcePath: source, sourcePageIndex: replaceSourcePage }, toast: `Replaced page ${currentPage + 1}`, onSuccess: () => setShowReplacePageModal(false) });
  };

  const openInterleaveModal = () => {
    if (!filePath) return;
    setInterleaveFilePath('');
    interleaveRange.reset(0, 0);
    setInterleaveSourcePageCount(null);
    setShowInterleaveModal(true);
  };

  const handleInterleaveSourcePathChange = async (value: string) => {
    setInterleaveFilePath(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setInterleaveSourcePageCount(null);
      return;
    }
    try {
      const count = await invoke<number>('get_pdf_page_count', { path: trimmed });
      setInterleaveSourcePageCount(count);
      interleaveRange.reset(0, Math.max(0, count - 1));
    } catch {
      setInterleaveSourcePageCount(null);
    }
  };

  const handleInterleavePdf = async () => {
    const source = interleaveFilePath.trim();
    if (!filePath || !source) return;
    const range = interleaveRange.validate();
    if (!range) return;
    await runEdit({ command: 'interleave_pdf', args: { otherPath: source, otherStart: interleaveRange.startPage, otherEnd: interleaveRange.endPage }, toast: (n) => `Interleaved ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowInterleaveModal(false) });
  };

  const handleSplitOddEven = async () => {
    if (!filePath || pageCount === null || pageCount < 2) {
      showToast('Need at least 2 pages', 'error');
      return;
    }
    await withLoading(async () => {
      const outputs = await invoke<string[]>('split_odd_even_pages', { path: filePath });
      showToast(`Split into ${outputs.length} files: ${outputs.map((p) => fileNameFromPath(p)).join(', ')}`);
    });
  };

  const handleDuplicateAllPages = async () => {
    if (!filePath || pageCount === null) return;
    await runEdit({ command: 'duplicate_all_pages', reloadAt: pageCount, toast: (n) => `Duplicated all ${n} pages at end` });
  };

  const openPageSizeModal = () => {
    if (!filePath || pageCount === null) return;
    pageSizeRange.reset();
    setPageSizePreset('letter');
    setShowPageSizeModal(true);
  };

  const handleSetPageSize = async () => {
    if (!filePath) return;
    const range = pageSizeRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'set_page_size', args: { startPage: start, endPage: end, preset: pageSizePreset }, toast: (n) => `Resized ${n} page${n === 1 ? '' : 's'} to ${pageSizePreset.toUpperCase()}`, onSuccess: () => setShowPageSizeModal(false) });
  };

  const handleSetPageSizeOddPages = async () => {
    await runEdit({ command: 'set_page_size_odd_pages', args: { preset: pageSizePreset }, toast: (n) => `Resized ${n} odd page${n === 1 ? '' : 's'} to ${pageSizePreset.toUpperCase()}`, onSuccess: () => setShowPageSizeModal(false) });
  };

  const handleSetPageSizeEvenPages = async () => {
    await runEdit({ command: 'set_page_size_even_pages', args: { preset: pageSizePreset }, toast: (n) => `Resized ${n} even page${n === 1 ? '' : 's'} to ${pageSizePreset.toUpperCase()}`, onSuccess: () => setShowPageSizeModal(false) });
  };

  const openDecryptModal = () => {
    setDecryptPassword('');
    setShowDecryptModal(true);
  };

  const handleRemovePdfPassword = async () => {
    if (!filePath || !decryptPassword) return;
    const sourcePath = originalPath || filePath;
    await withLoading(async () => {
      const written = await invoke<string>('remove_pdf_password', {
        path: sourcePath,
        password: decryptPassword,
      });
      setShowDecryptModal(false);
      setDecryptPassword('');
      showToast(`Saved decrypted copy to ${written}`);
    });
  };

  const defaultExportPagesPdfDir = () => {
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    return `${base}_pages`;
  };

  const openExportPagesPdfModal = () => {
    if (!filePath || pageCount === null) return;
    exportPagesPdfRange.reset();
    setExportPagesPdfOutputDir(defaultExportPagesPdfDir());
    setShowExportPagesPdfModal(true);
  };

  const handleExportPagesPdf = async () => {
    const outputDir = exportPagesPdfOutputDir.trim();
    if (!filePath || !outputDir) return;
    const range = exportPagesPdfRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await withLoading(async () => {
      const written = await invoke<string[]>('export_pdf_pages_as_pdf', {
        path: filePath,
        startPage: start,
        endPage: end,
        outputDir,
      });
      setShowExportPagesPdfModal(false);
      showToast(`Exported ${written.length} PDF file${written.length === 1 ? '' : 's'} to ${outputDir}`);
    });
  };

  const handleExportOddPagesAsPdf = async () => {
    const outputDir = exportPagesPdfOutputDir.trim();
    if (!filePath || !outputDir) return;
    await withLoading(async () => {
      const written = await invoke<string[]>('export_odd_pages_as_pdf', { path: filePath, outputDir });
      setShowExportPagesPdfModal(false);
      showToast(`Exported ${written.length} odd page PDF${written.length === 1 ? '' : 's'} to ${outputDir}`);
    });
  };

  const handleExportEvenPagesAsPdf = async () => {
    const outputDir = exportPagesPdfOutputDir.trim();
    if (!filePath || !outputDir) return;
    await withLoading(async () => {
      const written = await invoke<string[]>('export_even_pages_as_pdf', { path: filePath, outputDir });
      setShowExportPagesPdfModal(false);
      showToast(`Exported ${written.length} even page PDF${written.length === 1 ? '' : 's'} to ${outputDir}`);
    });
  };

  const parityBatchContext = () => ({
    filePath,
    startPage: parityRange.startPage,
    endPage: parityRange.endPage,
    outputPath: parityRangeOutputPath,
    marginTop: cropMarginTop,
    marginRight: cropMarginRight,
    marginBottom: cropMarginBottom,
    marginLeft: cropMarginLeft,
    watermarkText,
    pageHeaderText,
    pageFooterText,
    pageBorderInset,
    pageSizePreset,
    pageNumbersPrefix,
  });

  const openParityRangeModal = () => {
    if (!filePath || pageCount === null) return;
    parityRange.reset(currentPage, currentPage);
    setParityRangeCommand('rotate_odd_pages_in_range');
    setShowParityRangeModal(true);
  };

  const handleParityRangeAction = async () => {
    if (!filePath) return;
    const command = parityRangeCommand;
    if (parityBatchNeedsRange(command)) {
      const range = parityRange.validate();
      if (!range) return;
    }
    if ((command.startsWith('export_') || command.startsWith('extract_')) && !parityRangeOutputPath.trim()) {
      showToast('Output path or directory is required', 'error');
      return;
    }
    const payload = buildParityBatchPayload(command, parityBatchContext());
    if ((command.includes('watermark') || command.includes('header') || command.includes('footer'))
      && !payload.text) {
      showToast('Text is required for this action', 'error');
      return;
    }
    await withLoading(async () => {
      const result = await invoke<number | string | string[] | void>(command, payload);
      if (parityBatchMutatesPdf(command)) {
        markPdfEdited();
        await reloadOpenPdf(currentPage);
      }
      setShowParityRangeModal(false);
      if (typeof result === 'number') {
        showToast(`Done — affected ${result} item${result === 1 ? '' : 's'}`);
      } else if (Array.isArray(result)) {
        showToast(`Wrote ${result.length} file${result.length === 1 ? '' : 's'}`);
      } else if (typeof result === 'string') {
        showToast(`Wrote ${result}`);
      } else {
        showToast('Done');
      }
    });
  };

  const handleExportOddPagesImage = async () => {
    const outputDir = pngExportOutputPath.trim();
    if (!filePath || !outputDir) return;
    await withLoading(async () => {
      const written = await invoke<string[]>(parityImageExportCommand(imageExportFormat, true), { path: filePath, outputDir });
      setShowExportPngModal(false);
      showToast(`Exported ${written.length} odd page image${written.length === 1 ? '' : 's'} to ${outputDir}`);
    });
  };

  const handleExportEvenPagesImage = async () => {
    const outputDir = pngExportOutputPath.trim();
    if (!filePath || !outputDir) return;
    await withLoading(async () => {
      const written = await invoke<string[]>(parityImageExportCommand(imageExportFormat, false), { path: filePath, outputDir });
      setShowExportPngModal(false);
      showToast(`Exported ${written.length} even page image${written.length === 1 ? '' : 's'} to ${outputDir}`);
    });
  };

  const openRotateRangeModal = () => {
    if (!filePath || pageCount === null) return;
    rotateRange.reset(currentPage, currentPage);
    setShowRotateRangeModal(true);
  };

  const handleRotatePageRange = async (ccw: boolean) => {
    if (!filePath) return;
    const range = rotateRange.validate();
    if (!range) return;
    await withLoading(async () => {
      const cmd = ccw ? 'rotate_page_range_ccw' : 'rotate_page_range';
      const rotated = await invoke<number>(cmd, {
        path: filePath,
        startPage: rotateRange.startPage,
        endPage: rotateRange.endPage,
      });
      markPdfEdited();
      await reloadOpenPdf(currentPage);
      setShowRotateRangeModal(false);
      showToast(`Rotated ${rotated} page${rotated === 1 ? '' : 's'} ${ccw ? 'CCW' : 'CW'}`);
    });
  };

  const handleResetRotationRange = async () => {
    if (!filePath) return;
    const range = rotateRange.validate();
    if (!range) return;
    await runEdit({ command: 'reset_rotation_range', args: { startPage: rotateRange.startPage, endPage: rotateRange.endPage }, toast: (n) => `Reset rotation on ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowRotateRangeModal(false) });
  };

  const handleRotatePage180Range = async () => {
    if (!filePath) return;
    const range = rotateRange.validate();
    if (!range) return;
    await runEdit({ command: 'rotate_page_180_range', args: { startPage: rotateRange.startPage, endPage: rotateRange.endPage }, toast: (n) => `Rotated ${n} page${n === 1 ? '' : 's'} 180°`, onSuccess: () => setShowRotateRangeModal(false) });
  };

  const openReverseRangeModal = () => {
    if (!filePath || pageCount === null) return;
    reverseRange.reset(currentPage, currentPage);
    setShowReverseRangeModal(true);
  };

  const handleReversePageRange = async () => {
    if (!filePath) return;
    const range = reverseRange.validate();
    if (!range) return;
    await runEdit({ command: 'reverse_page_range', args: { startPage: reverseRange.startPage, endPage: reverseRange.endPage }, toast: `Reversed pages ${reverseRange.startPage + 1}–${reverseRange.endPage + 1}`, onSuccess: () => setShowReverseRangeModal(false) });
  };

  const openInsertBlankPagesModal = () => {
    if (!filePath) return;
    setInsertBlankCount(1);
    setInsertBlankAtIndex(currentPage + 1);
    setShowInsertBlankPagesModal(true);
  };

  const handleInsertBlankPages = async () => {
    if (!filePath || insertBlankCount < 1) return;
    await runEdit({ command: 'insert_blank_pages', args: { atIndex: insertBlankAtIndex, count: insertBlankCount }, reloadAt: insertBlankAtIndex, toast: (n) => `Inserted ${n} blank page${n === 1 ? '' : 's'}`, onSuccess: () => setShowInsertBlankPagesModal(false) });
  };

  const openCropRangeModal = () => {
    if (!filePath || pageCount === null) return;
    cropRange.reset(currentPage, currentPage);
    setCropMarginTop(50);
    setCropMarginRight(50);
    setCropMarginBottom(50);
    setCropMarginLeft(50);
    setShowCropRangeModal(true);
  };

  const handleCropPageRange = async () => {
    if (!filePath) return;
    const range = cropRange.validate();
    if (!range) return;
    await runEdit({ command: 'crop_page_range', args: { startPage: cropRange.startPage, endPage: cropRange.endPage, marginTop: cropMarginTop, marginRight: cropMarginRight, marginBottom: cropMarginBottom, marginLeft: cropMarginLeft }, toast: (n) => `Cropped ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowCropRangeModal(false) });
  };

  const handleFlattenAllAnnotations = async () => {
    await runEdit({ command: 'flatten_all_annotations', toast: (n) => `Flattened ${n} annotation${n === 1 ? '' : 's'} on all pages` });
  };

  const handleClearPdfMetadata = async () => {
    await runEdit({
      command: 'clear_pdf_metadata',
      skipReload: true,
      toast: 'Cleared document metadata',
      onSuccess: () => {
        setMetadataTitle('');
        setMetadataAuthor('');
        setMetadataSubject('');
        setMetadataKeywords('');
        setMetadataCreator('');
        setMetadataProducer('');
        setMetadataCreationDate('');
        setMetadataModDate('');
      },
    });
  };

  const handleSortPagesBySize = async (descending: boolean) => {
    await runEdit({ command: 'sort_pages_by_size', args: { descending }, reloadAt: 0, toast: `Sorted pages by size (${descending ? 'largest first' : 'smallest first'})` });
  };

  const openKeepRangeModal = () => {
    if (!filePath || pageCount === null) return;
    keepRange.reset(currentPage, currentPage);
    setShowKeepRangeModal(true);
  };

  const handleKeepPageRange = async () => {
    if (!filePath || pageCount === null) return;
    const range = keepRange.validate();
    if (!range) return;
    const keepCount = keepRange.endPage - keepRange.startPage + 1;
    if (keepCount >= pageCount) {
      showToast('Range already includes every page', 'error');
      return;
    }
    await runEdit<number>({
      command: 'keep_page_range',
      args: { startPage: keepRange.startPage, endPage: keepRange.endPage },
      reloadAt: Math.min(keepRange.startPage, keepCount - 1),
      toast: (deleted) => `Kept ${keepCount} page${keepCount === 1 ? '' : 's'}; removed ${deleted}`,
      onSuccess: () => setShowKeepRangeModal(false),
    });
  };

  const openMoveRangeModal = () => {
    if (!filePath || pageCount === null) return;
    moveRange.reset(currentPage, currentPage);
    setMoveRangeToIndex(currentPage);
    setShowMoveRangeModal(true);
  };

  const handleMovePageRange = async () => {
    if (!filePath || pageCount === null) return;
    const range = moveRange.validate();
    if (!range) return;
    if (moveRangeToIndex > pageCount) {
      showToast('Target index out of bounds', 'error');
      return;
    }
    await runEdit({ command: 'move_page_range', args: { startPage: moveRange.startPage, endPage: moveRange.endPage, toIndex: moveRangeToIndex }, reloadAt: moveRangeToIndex, toast: `Moved pages ${moveRange.startPage + 1}–${moveRange.endPage + 1} to index ${moveRangeToIndex + 1}`, onSuccess: () => setShowMoveRangeModal(false) });
  };

  const handleMovePageRangeToStart = async () => {
    if (!filePath) return;
    const range = moveRange.validate();
    if (!range) return;
    await runEdit({ command: 'move_page_range_to_start', args: { startPage: moveRange.startPage, endPage: moveRange.endPage }, reloadAt: 0, toast: `Moved pages ${moveRange.startPage + 1}–${moveRange.endPage + 1} to start`, onSuccess: () => setShowMoveRangeModal(false) });
  };

  const handleMovePageRangeToEnd = async () => {
    if (!filePath || pageCount === null) return;
    const range = moveRange.validate();
    if (!range) return;
    await runEdit({
      command: 'move_page_range_to_end',
      args: { startPage: moveRange.startPage, endPage: moveRange.endPage },
      reloadAt: pageCount - (moveRange.endPage - moveRange.startPage + 1),
      toast: `Moved pages ${moveRange.startPage + 1}–${moveRange.endPage + 1} to end`,
      onSuccess: () => setShowMoveRangeModal(false),
    });
  };

  const handleRotateOddPages = async () => {
    await runEdit({ command: 'rotate_odd_pages', toast: (n) => `Rotated ${n} odd page${n === 1 ? '' : 's'} 90° CW` });
  };

  const handleRotateEvenPages = async () => {
    await runEdit({ command: 'rotate_even_pages', toast: (n) => `Rotated ${n} even page${n === 1 ? '' : 's'} 90° CW` });
  };

  const handleRotateOddPagesCcw = async () => {
    await runEdit({ command: 'rotate_odd_pages_ccw', toast: (n) => `Rotated ${n} odd page${n === 1 ? '' : 's'} 90° CCW` });
  };

  const handleRotateEvenPagesCcw = async () => {
    await runEdit({ command: 'rotate_even_pages_ccw', toast: (n) => `Rotated ${n} even page${n === 1 ? '' : 's'} 90° CCW` });
  };

  const handleResetRotationOddPages = async () => {
    await runEdit({ command: 'reset_rotation_odd_pages', toast: (n) => `Reset rotation on ${n} odd page${n === 1 ? '' : 's'}` });
  };

  const handleResetRotationEvenPages = async () => {
    await runEdit({ command: 'reset_rotation_even_pages', toast: (n) => `Reset rotation on ${n} even page${n === 1 ? '' : 's'}` });
  };

  const handleKeepOddPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'keep_odd_pages', reloadAt: 0, toast: (n) => `Kept odd pages; removed ${n}` });
  };

  const handleKeepEvenPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'keep_even_pages', reloadAt: 0, toast: (n) => `Kept even pages; removed ${n}` });
  };

  const handleDeleteOddPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'delete_odd_pages', reloadAt: 0, toast: (n) => `Deleted ${n} odd page${n === 1 ? '' : 's'}` });
  };

  const handleDeleteEvenPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'delete_even_pages', reloadAt: 0, toast: (n) => `Deleted ${n} even page${n === 1 ? '' : 's'}` });
  };

  const handleRotate180OddPages = async () => {
    await runEdit({ command: 'rotate_180_odd_pages', toast: (n) => `Rotated ${n} odd page${n === 1 ? '' : 's'} 180°` });
  };

  const handleRotate180EvenPages = async () => {
    await runEdit({ command: 'rotate_180_even_pages', toast: (n) => `Rotated ${n} even page${n === 1 ? '' : 's'} 180°` });
  };

  const handleDuplicateOddPages = async () => {
    await runEdit({ command: 'duplicate_odd_pages', reloadAt: (pageCount ?? 1) - 1, toast: (n) => `Appended ${n} odd page cop${n === 1 ? 'y' : 'ies'}` });
  };

  const handleDuplicateEvenPages = async () => {
    await runEdit({ command: 'duplicate_even_pages', reloadAt: (pageCount ?? 1) - 1, toast: (n) => `Appended ${n} even page cop${n === 1 ? 'y' : 'ies'}` });
  };

  const handleInsertBlankBetweenPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'insert_blank_between_pages', reloadAt: currentPage * 2, toast: (n) => `Inserted ${n} blank page${n === 1 ? '' : 's'} between pages` });
  };

  const handleFlattenOddPages = async () => {
    await runEdit({ command: 'flatten_odd_pages', toast: (n) => `Flattened ${n} annotation${n === 1 ? '' : 's'} on odd pages` });
  };

  const handleFlattenEvenPages = async () => {
    await runEdit({ command: 'flatten_even_pages', toast: (n) => `Flattened ${n} annotation${n === 1 ? '' : 's'} on even pages` });
  };

  const handleRotateAllPages180 = async () => {
    await runEdit({ command: 'rotate_all_pages_180', toast: (n) => `Rotated all ${n} page${n === 1 ? '' : 's'} 180°` });
  };

  const handleCropOddPages = async () => {
    await runEdit({ command: 'crop_odd_pages', args: { marginTop: cropMarginTop, marginRight: cropMarginRight, marginBottom: cropMarginBottom, marginLeft: cropMarginLeft }, toast: (n) => `Cropped ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowCropRangeModal(false) });
  };

  const handleCropEvenPages = async () => {
    await runEdit({ command: 'crop_even_pages', args: { marginTop: cropMarginTop, marginRight: cropMarginRight, marginBottom: cropMarginBottom, marginLeft: cropMarginLeft }, toast: (n) => `Cropped ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowCropRangeModal(false) });
  };

  const handleExpandOddPages = async () => {
    await runEdit({ command: 'expand_odd_pages', args: { marginTop: expandMarginTop, marginRight: expandMarginRight, marginBottom: expandMarginBottom, marginLeft: expandMarginLeft }, toast: (n) => `Expanded margins on ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowExpandMarginsModal(false) });
  };

  const handleExpandEvenPages = async () => {
    await runEdit({ command: 'expand_even_pages', args: { marginTop: expandMarginTop, marginRight: expandMarginRight, marginBottom: expandMarginBottom, marginLeft: expandMarginLeft }, toast: (n) => `Expanded margins on ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowExpandMarginsModal(false) });
  };

  const handleShrinkOddPages = async () => {
    await runEdit({ command: 'shrink_odd_pages', args: { marginTop: shrinkMarginTop, marginRight: shrinkMarginRight, marginBottom: shrinkMarginBottom, marginLeft: shrinkMarginLeft }, toast: (n) => `Shrunk margins on ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowShrinkMarginsModal(false) });
  };

  const handleShrinkEvenPages = async () => {
    await runEdit({ command: 'shrink_even_pages', args: { marginTop: shrinkMarginTop, marginRight: shrinkMarginRight, marginBottom: shrinkMarginBottom, marginLeft: shrinkMarginLeft }, toast: (n) => `Shrunk margins on ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowShrinkMarginsModal(false) });
  };

  const handleReverseOddPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await withLoading(async () => {
      const reversed = await invoke<number>('reverse_odd_pages', { path: filePath });
      if (reversed === 0) {
        showToast('Need at least two odd pages to reverse', 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(0);
      showToast(`Reversed ${reversed} odd page${reversed === 1 ? '' : 's'}`);
    });
  };

  const handleReverseEvenPages = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await withLoading(async () => {
      const reversed = await invoke<number>('reverse_even_pages', { path: filePath });
      if (reversed === 0) {
        showToast('Need at least two even pages to reverse', 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(0);
      showToast(`Reversed ${reversed} even page${reversed === 1 ? '' : 's'}`);
    });
  };

  const handleMoveOddPagesToStart = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'move_odd_pages_to_start', reloadAt: 0, toast: 'Moved odd pages to start' });
  };

  const handleMoveEvenPagesToStart = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'move_even_pages_to_start', reloadAt: 0, toast: 'Moved even pages to start' });
  };

  const handleMoveOddPagesToEnd = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'move_odd_pages_to_end', reloadAt: 0, toast: 'Moved odd pages to end' });
  };

  const handleMoveEvenPagesToEnd = async () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await runEdit({ command: 'move_even_pages_to_end', reloadAt: 0, toast: 'Moved even pages to end' });
  };

  const handleClearCropOddPages = async () => {
    await runEdit({ command: 'clear_crop_odd_pages', toast: (n) => `Cleared crop on ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowCropModal(false) });
  };

  const handleClearCropEvenPages = async () => {
    await runEdit({ command: 'clear_crop_even_pages', toast: (n) => `Cleared crop on ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowCropModal(false) });
  };

  const handleDuplicateOddPagesBefore = async () => {
    await runEdit({ command: 'duplicate_odd_pages_before', toast: (n) => `Inserted ${n} odd page cop${n === 1 ? 'y' : 'ies'} before originals` });
  };

  const handleDuplicateEvenPagesBefore = async () => {
    await runEdit({ command: 'duplicate_even_pages_before', toast: (n) => `Inserted ${n} even page cop${n === 1 ? 'y' : 'ies'} before originals` });
  };

  const handleSortOddPagesByRotation = async (descending: boolean) => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await withLoading(async () => {
      const sorted = await invoke<number>('sort_odd_pages_by_rotation', { path: filePath, descending });
      if (sorted < 2) {
        showToast('Need at least two odd pages to sort by rotation', 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(0);
      showToast(`Sorted ${sorted} odd page${sorted === 1 ? '' : 's'} by rotation (${descending ? 'largest first' : 'smallest first'})`);
    });
  };

  const handleSortEvenPagesByRotation = async (descending: boolean) => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await withLoading(async () => {
      const sorted = await invoke<number>('sort_even_pages_by_rotation', { path: filePath, descending });
      if (sorted < 2) {
        showToast('Need at least two even pages to sort by rotation', 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(0);
      showToast(`Sorted ${sorted} even page${sorted === 1 ? '' : 's'} by rotation (${descending ? 'largest first' : 'smallest first'})`);
    });
  };

  const handleSortOddPagesBySize = async (descending: boolean) => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await withLoading(async () => {
      const sorted = await invoke<number>('sort_odd_pages_by_size', { path: filePath, descending });
      if (sorted < 2) {
        showToast('Need at least two odd pages to sort by size', 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(0);
      showToast(`Sorted ${sorted} odd page${sorted === 1 ? '' : 's'} by size (${descending ? 'largest first' : 'smallest first'})`);
    });
  };

  const handleSortEvenPagesBySize = async (descending: boolean) => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    await withLoading(async () => {
      const sorted = await invoke<number>('sort_even_pages_by_size', { path: filePath, descending });
      if (sorted < 2) {
        showToast('Need at least two even pages to sort by size', 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(0);
      showToast(`Sorted ${sorted} even page${sorted === 1 ? '' : 's'} by size (${descending ? 'largest first' : 'smallest first'})`);
    });
  };

  const handleSortPagesByRotation = async (descending: boolean) => {
    await runEdit({ command: 'sort_pages_by_rotation', args: { descending }, reloadAt: 0, toast: `Sorted pages by rotation (${descending ? 'largest first' : 'smallest first'})` });
  };

  const openSplitAtModal = () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    setSplitAtPage(Math.min(currentPage + 1, pageCount - 1) + 1);
    setShowSplitAtModal(true);
  };

  const handleSplitPdfAtPage = async () => {
    if (!filePath || pageCount === null) return;
    const atIndex = splitAtPage - 1;
    if (atIndex < 1 || atIndex >= pageCount) {
      showToast(`Split page must be between 2 and ${pageCount}`, 'error');
      return;
    }
    await withLoading(async () => {
      const written = await invoke<string[]>('split_pdf_at_page', {
        path: filePath,
        atPage: atIndex,
      });
      setShowSplitAtModal(false);
      showToast(`Split into ${written.length} files at page ${splitAtPage}`);
    });
  };

  const openDeleteNthModal = () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    setDeleteNthValue(2);
    setShowDeleteNthModal(true);
  };

  const handleDeleteEveryNthPage = async () => {
    if (!filePath || deleteNthValue < 2) return;
    await withLoading(async () => {
      const deleted = await invoke<number>('delete_every_nth_page', {
        path: filePath,
        nth: deleteNthValue,
      });
      if (deleted === 0) {
        showToast(`No pages are every ${deleteNthValue}th page`, 'error');
        return;
      }
      markPdfEdited();
      await reloadOpenPdf(Math.min(currentPage, (pageCount ?? 1) - deleted - 1));
      setShowDeleteNthModal(false);
      showToast(`Deleted ${deleted} page${deleted === 1 ? '' : 's'} (every ${deleteNthValue}th)`);
    });
  };

  const openExtractOddModal = () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    setExtractOddOutputPath(`${base}_odd_extract.pdf`);
    setShowExtractOddModal(true);
  };

  const handleExtractOddPages = async () => {
    if (!filePath || !extractOddOutputPath.trim()) return;
    await withLoading(async () => {
      const written = await invoke<string>('extract_odd_pages', {
        path: filePath,
        outputPath: extractOddOutputPath.trim(),
      });
      setShowExtractOddModal(false);
      showToast(`Extracted odd pages to ${written}`);
    });
  };

  const openExtractEvenModal = () => {
    if (!filePath || pageCount === null || pageCount < 2) return;
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    setExtractEvenOutputPath(`${base}_even_extract.pdf`);
    setShowExtractEvenModal(true);
  };

  const handleExtractEvenPages = async () => {
    if (!filePath || !extractEvenOutputPath.trim()) return;
    await withLoading(async () => {
      const written = await invoke<string>('extract_even_pages', {
        path: filePath,
        outputPath: extractEvenOutputPath.trim(),
      });
      setShowExtractEvenModal(false);
      showToast(`Extracted even pages to ${written}`);
    });
  };

  const openPrependModal = () => {
    if (!filePath) return;
    setPrependFilePath('');
    prependRange.reset(0, 0);
    setPrependSourcePageCount(null);
    setShowPrependModal(true);
  };

  const handlePrependSourcePathChange = async (value: string) => {
    setPrependFilePath(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setPrependSourcePageCount(null);
      return;
    }
    try {
      const count = await invoke<number>('get_pdf_page_count', { path: trimmed });
      setPrependSourcePageCount(count);
      prependRange.reset(0, Math.max(0, count - 1));
    } catch {
      setPrependSourcePageCount(null);
    }
  };

  const handlePrependPdf = async () => {
    const source = prependFilePath.trim();
    if (!filePath || !source) return;
    const range = prependRange.validate();
    if (!range) return;
    await runEdit<number>({
      command: 'prepend_pdf',
      args: { sourcePath: source, sourceStart: prependRange.startPage, sourceEnd: prependRange.endPage },
      reloadAt: (added) => currentPage + added,
      toast: (added) => `Prepended ${added} page${added === 1 ? '' : 's'}`,
      onSuccess: () => setShowPrependModal(false),
    });
  };

  const openSplitEveryModal = () => {
    if (!filePath) return;
    setSplitEveryN(2);
    setShowSplitEveryModal(true);
  };

  const handleSplitEveryN = async () => {
    if (!filePath || splitEveryN < 1) return;
    await withLoading(async () => {
      const outputs = await invoke<string[]>('split_every_n_pages', {
        path: filePath,
        pagesPerFile: splitEveryN,
      });
      setShowSplitEveryModal(false);
      showToast(`Split into ${outputs.length} file${outputs.length === 1 ? '' : 's'}`);
    });
  };

  const openPageBorderModal = () => {
    if (!filePath || pageCount === null) return;
    pageBorderRange.reset();
    setPageBorderInset(20);
    setShowPageBorderModal(true);
  };

  const handleAddPageBorder = async () => {
    if (!filePath) return;
    const range = pageBorderRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'add_page_border', args: { startPage: start, endPage: end, inset: pageBorderInset }, toast: (n) => `Added border to ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageBorderModal(false) });
  };

  const handleAddPageBorderOddPages = async () => {
    await runEdit({ command: 'add_page_border_odd_pages', args: { inset: pageBorderInset }, toast: (n) => `Added border to ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageBorderModal(false) });
  };

  const handleAddPageBorderEvenPages = async () => {
    await runEdit({ command: 'add_page_border_even_pages', args: { inset: pageBorderInset }, toast: (n) => `Added border to ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageBorderModal(false) });
  };

  const openBookmarkAllModal = () => {
    if (!filePath) return;
    setBookmarkAllPrefix('Page ');
    setShowBookmarkAllModal(true);
  };

  const handleBookmarkAllPages = async () => {
    await runEdit({ command: 'bookmark_all_pages', args: { prefix: bookmarkAllPrefix.trim() || 'Page ' }, afterEdit: async () => { await loadPdfBookmarks(filePath); }, toast: (n) => `Added ${n} bookmark${n === 1 ? '' : 's'}`, onSuccess: () => setShowBookmarkAllModal(false) });
  };

  const handleBookmarkOddPages = async () => {
    await runEdit({ command: 'bookmark_odd_pages', args: { prefix: bookmarkAllPrefix.trim() || 'Page ' }, afterEdit: async () => { await loadPdfBookmarks(filePath); }, toast: (n) => `Added ${n} odd bookmark${n === 1 ? '' : 's'}`, onSuccess: () => setShowBookmarkAllModal(false) });
  };

  const handleBookmarkEvenPages = async () => {
    await runEdit({ command: 'bookmark_even_pages', args: { prefix: bookmarkAllPrefix.trim() || 'Page ' }, afterEdit: async () => { await loadPdfBookmarks(filePath); }, toast: (n) => `Added ${n} even bookmark${n === 1 ? '' : 's'}`, onSuccess: () => setShowBookmarkAllModal(false) });
  };

  const handleInsertBlankBeforeOddPages = async () => {
    await runEdit({ command: 'insert_blank_before_odd_pages', toast: (n) => `Inserted ${n} blank page${n === 1 ? '' : 's'} before odd pages` });
  };

  const handleInsertBlankBeforeEvenPages = async () => {
    await runEdit({ command: 'insert_blank_before_even_pages', toast: (n) => `Inserted ${n} blank page${n === 1 ? '' : 's'} before even pages` });
  };

  const handleInsertBlankAfterOddPages = async () => {
    await runEdit({ command: 'insert_blank_after_odd_pages', toast: (n) => `Inserted ${n} blank page${n === 1 ? '' : 's'} after odd pages` });
  };

  const handleInsertBlankAfterEvenPages = async () => {
    await runEdit({ command: 'insert_blank_after_even_pages', toast: (n) => `Inserted ${n} blank page${n === 1 ? '' : 's'} after even pages` });
  };

  const handleDuplicateOddPagesToEnd = async () => {
    await runEdit({ command: 'duplicate_odd_pages_to_end', toast: (n) => `Moved ${n} odd page cop${n === 1 ? 'y' : 'ies'} to end` });
  };

  const handleDuplicateEvenPagesToEnd = async () => {
    await runEdit({ command: 'duplicate_even_pages_to_end', toast: (n) => `Moved ${n} even page cop${n === 1 ? 'y' : 'ies'} to end` });
  };

  const handleDuplicateOddPagesToStart = async () => {
    await runEdit({ command: 'duplicate_odd_pages_to_start', reloadAt: 0, toast: (n) => `Inserted ${n} odd page cop${n === 1 ? 'y' : 'ies'} at start` });
  };

  const handleDuplicateEvenPagesToStart = async () => {
    await runEdit({ command: 'duplicate_even_pages_to_start', reloadAt: 0, toast: (n) => `Inserted ${n} even page cop${n === 1 ? 'y' : 'ies'} at start` });
  };

  const handleDuplicatePageToEnd = async () => {
    await runEdit<number>({
      command: 'duplicate_page_to_end',
      args: { pageIndex: currentPage },
      reloadAt: (last) => last,
      toast: () => `Duplicated page ${currentPage + 1} to end`,
    });
  };

  const openExpandMarginsModal = () => {
    if (!filePath || pageCount === null) return;
    expandMarginsRange.reset();
    setExpandMarginTop(20);
    setExpandMarginRight(20);
    setExpandMarginBottom(20);
    setExpandMarginLeft(20);
    setShowExpandMarginsModal(true);
  };

  const openShrinkMarginsModal = () => {
    if (!filePath || pageCount === null) return;
    shrinkMarginsRange.reset();
    setShrinkMarginTop(20);
    setShrinkMarginRight(20);
    setShrinkMarginBottom(20);
    setShrinkMarginLeft(20);
    setShowShrinkMarginsModal(true);
  };

  const handleShrinkPageMargins = async () => {
    if (!filePath) return;
    const range = shrinkMarginsRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'shrink_page_margins', args: { startPage: start, endPage: end, marginTop: shrinkMarginTop, marginRight: shrinkMarginRight, marginBottom: shrinkMarginBottom, marginLeft: shrinkMarginLeft }, toast: (n) => `Shrunk margins on ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowShrinkMarginsModal(false) });
  };

  const handleExpandPageMargins = async () => {
    if (!filePath) return;
    const range = expandMarginsRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'expand_page_margins', args: { startPage: start, endPage: end, marginTop: expandMarginTop, marginRight: expandMarginRight, marginBottom: expandMarginBottom, marginLeft: expandMarginLeft }, toast: (n) => `Expanded margins on ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowExpandMarginsModal(false) });
  };

  const openInsertImagePageModal = () => {
    if (!filePath) return;
    setInsertImageAtIndex(currentPage + 1);
    setInsertImagePagePath('');
    setShowInsertImagePageModal(true);
  };

  const handleInsertImagePage = async () => {
    const image = insertImagePagePath.trim();
    if (!filePath || !image) return;
    await runEdit<number>({
      command: 'insert_image_page',
      args: { atIndex: insertImageAtIndex, imagePath: image },
      reloadAt: (newIndex) => newIndex,
      toast: (newIndex) => `Image page inserted at position ${newIndex + 1}`,
      onSuccess: () => setShowInsertImagePageModal(false),
    });
  };

  const defaultExportPagePdfPath = () => {
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    return `${base}_page_${currentPage + 1}.pdf`;
  };

  const openExportPagePdfModal = () => {
    if (!filePath) return;
    setExportPagePdfPath(defaultExportPagePdfPath());
    setShowExportPagePdfModal(true);
  };

  const handleExportPagePdf = async () => {
    const output = exportPagePdfPath.trim();
    if (!filePath || !output) return;
    await withLoading(async () => {
      const written = await invoke<string>('export_page_as_pdf', {
        path: filePath,
        pageIndex: currentPage,
        outputPath: ensureExtension(output, 'pdf'),
      });
      showToast(`Exported page to ${written}`);
      setShowExportPagePdfModal(false);
    });
  };

  const openDeleteRangeModal = () => {
    if (!filePath || pageCount === null) return;
    deleteRange.reset(currentPage, currentPage);
    setShowDeleteRangeModal(true);
  };

  const handleDeletePageRange = async () => {
    if (!filePath || pageCount === null) return;
    const range = deleteRange.validate();
    if (!range) return;
    const deleteCount = deleteRange.endPage - deleteRange.startPage + 1;
    if (deleteCount >= pageCount) {
      showToast('Cannot delete every page', 'error');
      return;
    }
    await withLoading(async () => {
      await invoke<number>('delete_page_range', {
        path: filePath,
        startPage: deleteRange.startPage,
        endPage: deleteRange.endPage,
      });
      markPdfEdited();
      const nextPage = deleteRange.startPage >= pageCount - deleteCount
        ? Math.max(0, pageCount - deleteCount - 1)
        : deleteRange.startPage;
      await reloadOpenPdf(nextPage);
      setShowDeleteRangeModal(false);
      showToast(`Deleted ${deleteCount} page${deleteCount === 1 ? '' : 's'}`);
    });
  };

  const openPageNumbersModal = () => {
    if (!filePath || pageCount === null) return;
    pageNumbersRange.reset();
    setPageNumbersPrefix('Page ');
    setShowPageNumbersModal(true);
  };

  const handleAddPageNumbers = async () => {
    if (!filePath) return;
    const range = pageNumbersRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'add_page_numbers', args: { startPage: start, endPage: end, prefix: pageNumbersPrefix || null }, toast: (n) => `Added page numbers to ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageNumbersModal(false) });
  };

  const handleAddPageNumbersOddPages = async () => {
    await runEdit({ command: 'add_page_numbers_odd_pages', args: { prefix: pageNumbersPrefix || null }, toast: (n) => `Added page numbers to ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageNumbersModal(false) });
  };

  const handleAddPageNumbersEvenPages = async () => {
    await runEdit({ command: 'add_page_numbers_even_pages', args: { prefix: pageNumbersPrefix || null }, toast: (n) => `Added page numbers to ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowPageNumbersModal(false) });
  };

  const openWatermarkModal = () => {
    if (!filePath || pageCount === null) return;
    watermarkRange.reset();
    setWatermarkText('DRAFT');
    setShowWatermarkModal(true);
  };

  const handleAddWatermark = async () => {
    if (!filePath || !watermarkText.trim()) return;
    const range = watermarkRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'add_text_watermark', args: { text: watermarkText.trim(), startPage: start, endPage: end }, toast: (n) => `Watermarked ${n} page${n === 1 ? '' : 's'}`, onSuccess: () => setShowWatermarkModal(false) });
  };

  const handleAddWatermarkOddPages = async () => {
    if (!filePath || !watermarkText.trim()) return;
    await runEdit({ command: 'add_text_watermark_odd_pages', args: { text: watermarkText.trim() }, toast: (n) => `Watermarked ${n} odd page${n === 1 ? '' : 's'}`, onSuccess: () => setShowWatermarkModal(false) });
  };

  const handleAddWatermarkEvenPages = async () => {
    if (!filePath || !watermarkText.trim()) return;
    await runEdit({ command: 'add_text_watermark_even_pages', args: { text: watermarkText.trim() }, toast: (n) => `Watermarked ${n} even page${n === 1 ? '' : 's'}`, onSuccess: () => setShowWatermarkModal(false) });
  };

  const openCropModal = () => {
    if (!filePath) return;
    setCropMarginTop(50);
    setCropMarginRight(50);
    setCropMarginBottom(50);
    setCropMarginLeft(50);
    setCropApplyAll(false);
    void loadPageSizes(filePath);
    setShowCropModal(true);
  };

  const handleCropPage = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      if (cropApplyAll) {
        const count = await invoke<number>('crop_all_pages', {
          path: filePath,
          marginTop: cropMarginTop,
          marginRight: cropMarginRight,
          marginBottom: cropMarginBottom,
          marginLeft: cropMarginLeft,
        });
        markPdfEdited();
        await reloadOpenPdf(currentPage);
        setShowCropModal(false);
        showToast(`Cropped ${count} page${count === 1 ? '' : 's'}`);
        return;
      }
      await invoke('crop_page', {
        path: filePath,
        pageIndex: currentPage,
        marginTop: cropMarginTop,
        marginRight: cropMarginRight,
        marginBottom: cropMarginBottom,
        marginLeft: cropMarginLeft,
      });
      markPdfEdited();
      await reloadOpenPdf(currentPage);
      setShowCropModal(false);
      showToast(`Cropped page ${currentPage + 1}`);
    });
  };

  const handleClearPageCrop = async () => {
    await runEdit({ command: 'clear_page_crop', args: { pageIndex: currentPage }, toast: `Cleared crop on page ${currentPage + 1}` });
  };

  const openFlattenModal = () => {
    if (!filePath || pageCount === null) return;
    flattenRange.reset();
    setShowFlattenModal(true);
  };

  const handleFlattenAnnotations = async () => {
    if (!filePath) return;
    const range = flattenRange.validateAndResolve();
    if (!range) return;
    const { start, end } = range;
    await runEdit({ command: 'flatten_annotations', args: { startPage: start, endPage: end }, toast: (n) => `Removed ${n} annotation${n === 1 ? '' : 's'}`, onSuccess: () => setShowFlattenModal(false) });
  };

  const openAddBookmarkModal = () => {
    if (!filePath) return;
    setBookmarkTitle(`Page ${currentPage + 1}`);
    setShowAddBookmarkModal(true);
  };

  const handleAddBookmark = async () => {
    if (!filePath || !bookmarkTitle.trim()) return;
    await runEdit({ command: 'add_pdf_bookmark', args: { title: bookmarkTitle.trim(), pageIndex: currentPage }, afterEdit: async () => { await loadPdfBookmarks(filePath); }, toast: 'Bookmark added', onSuccess: () => setShowAddBookmarkModal(false) });
  };

  const openRenameBookmarkModal = (index: number, title: string) => {
    setRenameBookmarkIndex(index);
    setRenameBookmarkTitle(title);
    setShowRenameBookmarkModal(true);
  };

  const handleRenameBookmark = async () => {
    if (!filePath || !renameBookmarkTitle.trim()) return;
    await runEdit({ command: 'rename_pdf_bookmark', args: { bookmarkIndex: renameBookmarkIndex, title: renameBookmarkTitle.trim() }, afterEdit: async () => { await loadPdfBookmarks(filePath); }, toast: 'Bookmark renamed', onSuccess: () => setShowRenameBookmarkModal(false) });
  };

  const handleRemoveBookmark = async (index: number) => {
    await runEdit({
      command: 'remove_pdf_bookmark',
      args: { bookmarkIndex: index },
      afterEdit: async () => { await loadPdfBookmarks(filePath); },
      toast: 'Bookmark removed',
    });
  };

  const openMergeModal = () => {
    if (!filePath) return;
    setShowMergeModal(true);
  };

  const openSearchModal = () => {
    if (!filePath) return;
    setShowSearchModal(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const closeSearchModal = () => {
    setShowSearchModal(false);
    setActiveSearchRect(null);
  };

  const goToSearchMatch = async (index: number, results: PdfTextSearchMatch[] = searchResults) => {
    if (!filePath || results.length === 0) return;
    const clamped = Math.max(0, Math.min(index, results.length - 1));
    const match = results[clamped];
    setSearchResultIndex(clamped);
    setActiveSearchRect(match.rect);
    setViewMode('pdf');
    setCurrentPage(match.page_index);
    setPageInput(String(match.page_index + 1));
    await withLoading(() => renderPage(filePath, match.page_index));
  };

  const runPdfSearch = async () => {
    if (!filePath || !searchQuery.trim()) return;
    await withLoading(async () => {
      const results = await invoke<PdfTextSearchMatch[]>('search_pdf_text', {
        path: filePath,
        query: searchQuery.trim(),
        matchCase: searchMatchCase,
        matchWholeWord: searchWholeWord,
      });
      setSearchResults(results);
      if (results.length === 0) {
        setSearchResultIndex(0);
        setActiveSearchRect(null);
        showToast('No matches found', 'error');
        return;
      }
      showToast(`${results.length} match${results.length === 1 ? '' : 'es'} found`);
      await goToSearchMatch(0, results);
    });
  };

  const stepSearchMatch = (delta: number) => {
    if (searchResults.length === 0) return;
    const next = (searchResultIndex + delta + searchResults.length) % searchResults.length;
    void goToSearchMatch(next);
  };

  const handleDeletePage = async () => {
    if (!filePath || pageCount === null) return;
    if (pageCount <= 1) {
      showToast('Cannot delete the only page', 'error');
      return;
    }
    const pageNumber = parseInt(deletePageInput, 10);
    if (Number.isNaN(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      showToast(`Enter a page from 1 to ${pageCount}`, 'error');
      setDeletePageInput(String(currentPage + 1));
      return;
    }
    const targetPage = pageNumber - 1;
    await withLoading(async () => {
      await invoke('delete_page', { path: filePath, pageIndex: targetPage });
      markPdfEdited();
      const count = await invoke<number>('get_pdf_page_count', { path: filePath });
      setPageCount(count);
      const newPage = Math.min(targetPage, count - 1);
      setCurrentPage(newPage);
      await loadThumbnails(filePath);
      await renderPage(filePath, newPage);
      setShowDeleteModal(false);
      showToast(`Page ${pageNumber} deleted`);
    });
  };

  const handleRotatePage = async () => {
    await runEdit({ command: 'rotate_page', args: { pageIndex: currentPage }, toast: 'Page rotated 90°' });
  };

  const handleDuplicatePageBefore = async () => {
    await runEdit<number>({
      command: 'duplicate_page_before',
      args: { pageIndex: currentPage },
      reloadAt: (newIndex) => newIndex,
      toast: () => `Duplicated page ${currentPage + 1} before itself`,
    });
  };

  const handleDuplicatePage = async () => {
    if (!filePath) return;
    const sourcePage = currentPage;
    await withLoading(async () => {
      const newIndex = await invoke<number>('duplicate_page', {
        path: filePath,
        pageIndex: sourcePage,
      });
      markPdfEdited();
      const count = await invoke<number>('get_pdf_page_count', { path: filePath });
      setPageCount(count);
      setCurrentPage(newIndex);
      setPageInput(String(newIndex + 1));
      await renderPage(filePath, newIndex);
      await loadThumbnails(filePath);
      showToast(`Page ${sourcePage + 1} duplicated`);
    });
  };

  // Zoom
  const zoomIn = () => setZoom((z) => clampZoom(+(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => clampZoom(+(z - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => setZoom(1);

  const commitZoom = () => {
    const n = parseInt(zoomInput, 10);
    if (Number.isNaN(n)) {
      setZoomInput(String(Math.round(zoom * 100)));
      return;
    }
    setZoom(clampZoom(n / 100));
  };

  const commitPage = () => {
    const n = parseInt(pageInput, 10);
    if (Number.isNaN(n) || pageCount === null) {
      setPageInput(String(currentPage + 1));
      return;
    }
    goToPage(n - 1);
  };

  // Wheel-driven page turn at the scroll boundaries.
  const handleWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el || pageCount === null || viewMode !== 'pdf') return;

    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const now = Date.now();
    if (now - lastWheelNavRef.current < WHEEL_NAV_COOLDOWN) return;

    if (e.deltaY > 0 && atBottom && currentPage < pageCount - 1) {
      lastWheelNavRef.current = now;
      pendingScrollRef.current = 'top';
      goToPage(currentPage + 1);
    } else if (e.deltaY < 0 && atTop && currentPage > 0) {
      lastWheelNavRef.current = now;
      pendingScrollRef.current = 'bottom';
      goToPage(currentPage - 1);
    }
  };

  // After a wheel page-turn, position the new page sensibly: top when going
  // forward, bottom when going back.
  const handleImageLoad = () => {
    const el = scrollRef.current;
    if (!el || pendingScrollRef.current === null) return;
    el.scrollTop = pendingScrollRef.current === 'bottom' ? el.scrollHeight : 0;
    pendingScrollRef.current = null;
  };

  // Highlight annotation handlers — coordinates are stored in natural (unscaled)
  // image pixels so they stay aligned regardless of the current zoom.
  const getImageCoords = (clientX: number, clientY: number) => {
    if (!imgRef.current) return { x: 0, y: 0 };
    const b = imgRef.current.getBoundingClientRect();
    return {
      x: (clientX - b.left) / zoom,
      y: (clientY - b.top) / zoom,
    };
  };

  const refreshAnnotations = async () => {
    const annots = await invoke<AnnotationData[]>('get_annotations', {
      path: filePath, pageIndex: currentPage,
    });
    setAnnotations(annots);
  };

  const loadFormFields = useCallback(async (path: string = filePath) => {
    if (!path) {
      setFormFields([]);
      setFormDrafts({});
      return;
    }
    try {
      const fields = await invoke<FormFieldData[]>('get_pdf_form_fields', { path });
      setFormFields(fields);
      const drafts: Record<string, string> = {};
      fields.forEach((field) => {
        if (field.field_type === 'checkbox' || field.field_type === 'radio') {
          drafts[field.name] = field.checked ? 'true' : 'false';
        } else {
          drafts[field.name] = field.value;
        }
      });
      setFormDrafts(drafts);
    } catch {
      setFormFields([]);
      setFormDrafts({});
    }
  }, [filePath]);

  const loadPdfBookmarks = useCallback(async (path: string = filePath) => {
    if (!path) {
      setPdfBookmarks([]);
      return;
    }
    try {
      const bookmarks = await invoke<PdfBookmarkEntry[]>('get_pdf_bookmarks', { path });
      setPdfBookmarks(bookmarks);
    } catch {
      setPdfBookmarks([]);
    }
  }, [filePath]);
  loadPdfBookmarksRef.current = (path) => { void loadPdfBookmarks(path); };

  const loadPdfSignatures = useCallback(async (path: string = filePath) => {
    if (!path) {
      setPdfSignatures([]);
      setSignatureVerification(null);
      return;
    }
    try {
      const [listed, verified] = await Promise.all([
        invoke<PdfSignatureInfo[]>('list_pdf_signatures', { path }),
        invoke<PdfSignatureVerificationSummary>('verify_pdf_signatures', { path, trustPemPath: null }),
      ]);
      setPdfSignatures(listed);
      setSignatureVerification(verified);
    } catch {
      setPdfSignatures([]);
      setSignatureVerification(null);
    }
  }, [filePath]);

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

  const cancelDrawing = () => {
    setDrawing(false);
    setHighlightStart(null);
    setHighlightRect(null);
    setInkDrawing(false);
    setInkDraft([]);
    setShapeLineEnd(null);
  };
  cancelDrawingRef.current = cancelDrawing;

  // Highlighting is a two-click gesture: click once to set the start corner,
  // move the mouse to rubber-band the selection, click again to finish.
  const handlePageClick = (e: React.MouseEvent) => {
    if (drawMode) return;
    if (textEditMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      setPendingTextPos(coords);
      setPageTextDraft('');
      setEditingTextIndex(null);
      setShowPageTextModal(true);
      return;
    }
    if (vectorEditMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!drawing) {
        setHighlightStart(coords);
        setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        setDrawing(true);
        return;
      }
      const start = highlightStart;
      cancelDrawing();
      if (!start) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 4 || rect.h < 4) return;
      void withLoading(async () => {
        await invoke('add_page_vector_rect', {
          path: filePath,
          pageIndex: currentPage,
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
        });
        markPdfEdited();
        await renderPage(filePath, currentPage);
        showToast('Vector shape added');
      });
      return;
    }
    if (formAddMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      const placeFormField = (rect: { x: number; y: number; w: number; h: number }) => {
        void withLoading(async () => {
          const base = {
            path: filePath,
            pageIndex: currentPage,
            x: rect.x,
            y: rect.y,
            width: rect.w,
            height: rect.h,
          };
          if (newFormFieldKind === 'checkbox') {
            await invoke('add_checkbox_form_field', {
              ...base,
              name: newFormFieldName.trim(),
              checked: newFormCheckboxChecked,
            });
          } else if (newFormFieldKind === 'choice') {
            const options = newFormFieldOptions.split(',').map((o) => o.trim()).filter(Boolean);
            await invoke('add_choice_form_field', {
              ...base,
              name: newFormFieldName.trim(),
              options,
              combo: true,
            });
          } else if (newFormFieldKind === 'radio') {
            await invoke('add_radio_form_field', {
              ...base,
              groupName: newFormRadioGroup.trim(),
              optionName: newFormRadioOption.trim(),
            });
          } else {
            await invoke('add_text_form_field', {
              ...base,
              name: newFormFieldName.trim(),
            });
          }
          markPdfEdited();
          setFormAddMode(false);
          setShowAddFormFieldModal(false);
          setNewFormFieldName('');
          setNewFormRadioGroup('');
          setNewFormRadioOption('');
          await loadFormFields(filePath);
          showToast('Form field added');
        });
      };

      if (newFormFieldKind === 'checkbox' || newFormFieldKind === 'radio') {
        const size = 18;
        placeFormField({ x: coords.x, y: coords.y, w: size, h: size });
        cancelDrawing();
        return;
      }

      if (!drawing) {
        setHighlightStart(coords);
        setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        setDrawing(true);
        return;
      }
      const start = highlightStart;
      cancelDrawing();
      if (!start || !newFormFieldName.trim()) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 20 || rect.h < 10) return;
      placeFormField(rect);
      return;
    }
    if (imageInsertMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!drawing) {
        setHighlightStart(coords);
        setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        setDrawing(true);
        return;
      }
      const start = highlightStart;
      cancelDrawing();
      if (!start || !imageSourcePath) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      void withLoading(async () => {
        await invoke('add_page_image', {
          path: filePath,
          pageIndex: currentPage,
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          imagePath: imageSourcePath,
        });
        markPdfEdited();
        await renderPage(filePath, currentPage);
        showToast('Image inserted');
      });
      return;
    }
    if (redactMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!drawing) {
        setHighlightStart(coords);
        setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        setDrawing(true);
        return;
      }
      const start = highlightStart;
      cancelDrawing();
      if (!start) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      void runEdit({ command: 'add_redaction', args: { pageIndex: currentPage, x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Redaction added' });
      return;
    }
    if (stampMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      void withLoading(async () => {
        if (stampKind === 'image') {
          await invoke('add_image_stamp', {
            path: filePath,
            pageIndex: currentPage,
            x: coords.x,
            y: coords.y,
            preset: stampPreset,
          });
        } else {
          await invoke('add_text_stamp', {
            path: filePath,
            pageIndex: currentPage,
            x: coords.x,
            y: coords.y,
            preset: stampPreset,
          });
        }
        markPdfEdited();
        await refreshAnnotations();
        showToast('Stamp added');
      });
      return;
    }
    if (shapeMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!drawing) {
        setHighlightStart(coords);
        setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        setShapeLineEnd(coords);
        setDrawing(true);
        return;
      }
      const start = highlightStart;
      cancelDrawing();
      if (!start) return;
      if (shapeKind === 'line') {
        const dist = Math.hypot(coords.x - start.x, coords.y - start.y);
        if (dist < 5) return;
        void runEdit({ command: 'add_line', args: { pageIndex: currentPage, x1: start.x, y1: start.y, x2: coords.x, y2: coords.y }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Line added' });
        return;
      }
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      void withLoading(async () => {
        const args = {
          path: filePath,
          pageIndex: currentPage,
          x1: rect.x,
          y1: rect.y,
          x2: rect.x + rect.w,
          y2: rect.y + rect.h,
        };
        if (shapeKind === 'circle') await invoke('add_circle', args);
        else await invoke('add_square', args);
        markPdfEdited();
        await refreshAnnotations();
        showToast(shapeKind === 'circle' ? 'Ellipse added' : 'Rectangle added');
      });
      return;
    }
    if (noteMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      setPendingNotePos(coords);
      setNoteDraft('');
      setShowNoteModal(true);
      return;
    }
    if (!highlightMode) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    if (!drawing) {
      setHighlightStart(coords);
      setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
      setDrawing(true);
      return;
    }
    const start = highlightStart;
    cancelDrawing();
    if (!start) return;
    const rect = {
      x: Math.min(start.x, coords.x),
      y: Math.min(start.y, coords.y),
      w: Math.abs(coords.x - start.x),
      h: Math.abs(coords.y - start.y),
    };
    if (rect.w < 5 || rect.h < 5) return;
    void runEdit({ command: 'add_highlight', args: { pageIndex: currentPage, x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Highlight added' });
  };

  const handlePageMouseMove = (e: React.MouseEvent) => {
    if (drawMode && inkDrawing) {
      const coords = getImageCoords(e.clientX, e.clientY);
      setInkDraft((prev) => {
        if (prev.length < 2) return [...prev, coords.x, coords.y];
        const lx = prev[prev.length - 2];
        const ly = prev[prev.length - 1];
        if (Math.hypot(coords.x - lx, coords.y - ly) < 2) return prev;
        return [...prev, coords.x, coords.y];
      });
      return;
    }
    if ((shapeMode || redactMode || imageInsertMode || vectorEditMode || formAddMode) && drawing && highlightStart) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (shapeMode && shapeKind === 'line') {
        setShapeLineEnd(coords);
        return;
      }
      setHighlightRect({
        x: Math.min(highlightStart.x, coords.x),
        y: Math.min(highlightStart.y, coords.y),
        w: Math.abs(coords.x - highlightStart.x),
        h: Math.abs(coords.y - highlightStart.y),
      });
      return;
    }
    if (!highlightMode || !drawing || !highlightStart) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    setHighlightRect({
      x: Math.min(highlightStart.x, coords.x),
      y: Math.min(highlightStart.y, coords.y),
      w: Math.abs(coords.x - highlightStart.x),
      h: Math.abs(coords.y - highlightStart.y),
    });
  };

  const removeAnnotation = (command: AnnotationRemoveCommand, index: number, toast: string) => {
    runAnnotationRemoveViaEdit(runEdit, refreshAnnotations, command, currentPage, index, toast);
  };

  const removeRedaction = (index: number) => {
    removeAnnotation('remove_redaction', index, 'Redaction removed');
  };

  const removeStamp = (kind: StampKind, index: number) => {
    const command = kind === 'text' ? 'remove_text_stamp' : 'remove_image_stamp';
    removeAnnotation(command, index, 'Stamp removed');
  };

  const removeShape = (subtype: 'Square' | 'Circle' | 'Line', index: number) => {
    const command = subtype === 'Square' ? 'remove_square' : subtype === 'Circle' ? 'remove_circle' : 'remove_line';
    removeAnnotation(command, index, 'Shape removed');
  };

  const commitInkStroke = (points: number[]) => {
    if (points.length < 4) return;
    void runEdit({ command: 'add_ink_stroke', args: { pageIndex: currentPage, points }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Drawing added' });
  };

  const handleDrawMouseDown = (e: React.MouseEvent) => {
    if (!drawMode) return;
    e.preventDefault();
    const coords = getImageCoords(e.clientX, e.clientY);
    setInkDrawing(true);
    setInkDraft([coords.x, coords.y]);
  };

  const handleDrawMouseUp = () => {
    if (!drawMode || !inkDrawing) return;
    setInkDrawing(false);
    const points = inkDraft;
    setInkDraft([]);
    commitInkStroke(points);
  };

  const removeInkStroke = (inkIndex: number) => {
    removeAnnotation('remove_ink_stroke', inkIndex, 'Drawing removed');
  };

  // Click an existing highlight (while in highlight mode) to remove it.
  const removeHighlight = (highlightIndex: number) => {
    removeAnnotation('remove_highlight', highlightIndex, 'Highlight removed');
  };

  const openImageInsertModal = () => {
    if (!filePath) return;
    setImageSourceDraft(imageSourcePath);
    setShowImageInsertModal(true);
  };

  const confirmImageSource = async () => {
    const path = imageSourceDraft.trim();
    if (!path) {
      showToast('Enter an image path', 'error');
      return;
    }
    try {
      await invoke<[number, number]>('get_image_dimensions', { path });
      setImageSourcePath(path);
      setShowImageInsertModal(false);
      cancelDrawing();
      setHighlightMode(false);
      setNoteMode(false);
      setDrawMode(false);
      setShapeMode(false);
      setStampMode(false);
      setRedactMode(false);
      setImageInsertMode(true);
      showToast('Click twice on the page to place the image');
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  const toggleImageInsertMode = () => {
    if (!imageSourcePath) {
      openImageInsertModal();
      return;
    }
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setImageInsertMode((m) => !m);
  };

  const exitImageInsertMode = () => {
    cancelDrawing();
    setImageInsertMode(false);
    setFormAddMode(false);
  };

  const toggleFormsPanel = () => {
    setShowFormsPanel((open) => !open);
  };

  const openAddFormFieldModal = () => {
    if (!filePath) return;
    setNewFormFieldKind('text');
    setNewFormFieldName('');
    setNewFormFieldOptions('Option A, Option B');
    setNewFormRadioGroup('');
    setNewFormRadioOption('');
    setNewFormCheckboxChecked(false);
    setShowAddFormFieldModal(true);
  };

  const confirmAddFormField = () => {
    if (newFormFieldKind === 'radio') {
      if (!newFormRadioGroup.trim() || !newFormRadioOption.trim()) {
        showToast('Enter group and option names', 'error');
        return;
      }
    } else if (!newFormFieldName.trim()) {
      showToast('Enter a field name', 'error');
      return;
    }
    if (newFormFieldKind === 'choice') {
      const options = newFormFieldOptions.split(',').map((o) => o.trim()).filter(Boolean);
      if (options.length === 0) {
        showToast('Enter at least one option', 'error');
        return;
      }
    }
    setShowAddFormFieldModal(false);
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setFormAddMode(true);
    const placementHint = newFormFieldKind === 'text' || newFormFieldKind === 'choice'
      ? 'Click twice on the page to draw the field box'
      : 'Click on the page to place the field';
    showToast(placementHint);
  };

  const exitFormAddMode = () => {
    cancelDrawing();
    setFormAddMode(false);
  };

  const toggleHighlightMode = () => {
    cancelDrawing();
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setHighlightMode((m) => !m);
  };

  const exitHighlightMode = () => {
    cancelDrawing();
    setHighlightMode(false);
  };

  const toggleNoteMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setNoteMode((m) => !m);
  };

  const toggleDrawMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setDrawMode((m) => !m);
  };

  const exitDrawMode = () => {
    cancelDrawing();
    setDrawMode(false);
  };

  const toggleShapeMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setShapeMode((m) => !m);
  };

  const exitShapeMode = () => {
    cancelDrawing();
    setShapeMode(false);
  };

  const toggleStampMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setStampMode((m) => !m);
  };

  const exitStampMode = () => {
    setStampMode(false);
  };

  const toggleTextEditMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setVectorEditMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setTextEditMode((mode) => !mode);
  };

  const exitTextEditMode = () => {
    setTextEditMode(false);
    setShowPageTextModal(false);
    setPendingTextPos(null);
    setEditingTextIndex(null);
  };

  const toggleVectorEditMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setRedactMode(false);
    setImageInsertMode(false);
    setTextEditMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setVectorEditMode((mode) => !mode);
  };

  const exitVectorEditMode = () => {
    cancelDrawing();
    setVectorEditMode(false);
  };

  const submitPageText = async () => {
    const text = pageTextDraft.trim();
    const fontSize = Number.parseFloat(pageTextFontSize);
    if (!filePath || !text || Number.isNaN(fontSize)) return;
    const pos = pendingTextPos;
    if (editingTextIndex === null && !pos) return;
    await withLoading(async () => {
      const wasEdit = editingTextIndex !== null;
      if (wasEdit) {
        await invoke('update_page_text', {
          path: filePath,
          pageIndex: currentPage,
          index: editingTextIndex,
          text,
          x: pos?.x ?? null,
          y: pos?.y ?? null,
          fontSize,
        });
      } else if (pos) {
        await invoke('add_page_text', {
          path: filePath,
          pageIndex: currentPage,
          x: pos.x,
          y: pos.y,
          fontSize,
          text,
        });
      }
      markPdfEdited();
      setShowPageTextModal(false);
      setPendingTextPos(null);
      setEditingTextIndex(null);
      await renderPage(filePath, currentPage);
      showToast(wasEdit ? 'Text updated' : 'Text added to page');
    });
  };

  const startEditPageText = (edit: PageTextEdit) => {
    setEditingTextIndex(edit.index);
    setPendingTextPos({ x: edit.x, y: edit.y });
    setPageTextDraft(edit.text);
    setPageTextFontSize(String(edit.font_size));
    setShowPageEditsModal(false);
    setShowPageTextModal(true);
  };

  const closePageTextModal = () => {
    setShowPageTextModal(false);
    setEditingTextIndex(null);
    setPendingTextPos(null);
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPendingEncryptedPath('');
    setPdfPasswordDraft('');
  };

  const removePageTextEdit = async (index: number) => {
    if (!filePath) return;
    await withLoading(async () => {
      await invoke('remove_page_text', { path: filePath, pageIndex: currentPage, index });
      markPdfEdited();
      await renderPage(filePath, currentPage);
      showToast('Text removed');
    });
  };

  const removePageVectorEdit = async (index: number) => {
    if (!filePath) return;
    await withLoading(async () => {
      await invoke('remove_page_vector', { path: filePath, pageIndex: currentPage, index });
      markPdfEdited();
      await renderPage(filePath, currentPage);
      showToast('Vector shape removed');
    });
  };

  const toggleRedactMode = () => {
    cancelDrawing();
    setHighlightMode(false);
    setNoteMode(false);
    setDrawMode(false);
    setShapeMode(false);
    setStampMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setRedactMode((m) => !m);
  };

  const exitRedactMode = () => {
    cancelDrawing();
    setRedactMode(false);
  };

  const exitNoteMode = () => {
    setNoteMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setNoteDraft('');
  };

  const removeTextNote = (noteIndex: number) => {
    removeAnnotation('remove_text_note', noteIndex, 'Note removed');
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

  const handleSave = async () => {
    if (!filePath || !originalPath) return;
    await withLoading(async () => {
      await invoke('save_working_copy', { working: filePath, target: originalPath });
      markSaved();
      showToast('Saved');
    });
  };

  const chooseOpenPdfNative = async () => {
    const path = await pickPdfWithNativeDialog(openFilePath || lastBrowserDir || originalPath);
    if (!path) return;
    setOpenFilePath(path);
    const loaded = await loadPdfFromPath(path);
    if (loaded) setShowOpenModal(false);
  };

  const chooseInsertPdfNative = async () => {
    const path = await pickPdfWithNativeDialog(insertFilePath || lastBrowserDir || originalPath);
    if (!path) return;
    setInsertFilePath(path);
    rememberBrowserDirectory(path);
  };

  const chooseMergePdfNative = async () => {
    const path = await pickPdfWithNativeDialog(mergeFilePath || lastBrowserDir || originalPath);
    if (!path) return;
    setMergeFilePath(path);
    rememberBrowserDirectory(path);
  };

  const handleSaveAs = async () => {
    const target = saveAsPath.trim();
    if (!filePath || !target) return;
    await withLoading(async () => {
      await invoke('save_working_copy', { working: filePath, target });
      setOriginalPath(target);
      rememberOpenedPdf(target);
      markSaved();
      setShowSaveAsModal(false);
      showToast(`Saved to ${target}`);
    });
  };

  const saveAsViaNativeDialog = async () => {
    if (!filePath || !originalPath) return;
    const picked = await pickSaveWithNativeDialog(saveAsPath || originalPath, PDF_DIALOG_FILTER);
    if (!picked) return;
    const target = ensureExtension(picked, 'pdf');
    await withLoading(async () => {
      await invoke('save_working_copy', { working: filePath, target });
      setOriginalPath(target);
      rememberOpenedPdf(target);
      markSaved();
      setShowSaveAsModal(false);
      showToast(`Saved to ${target}`);
    });
  };

  const chooseSaveAsNative = async () => {
    const picked = await pickSaveWithNativeDialog(saveAsPath || originalPath, PDF_DIALOG_FILTER);
    if (!picked) return;
    setSaveAsPath(ensureExtension(picked, 'pdf'));
  };

  const openSaveAs = () => {
    if (nativeDialogs) {
      void saveAsViaNativeDialog();
      return;
    }
    setSaveAsPath(originalPath);
    setShowSaveAsModal(true);
  };

  // Run `action`, but if there are unsaved edits prompt Save/Discard/Cancel first.
  const guardUnsaved = (action: () => void | Promise<void>) => {
    if (isDirty) {
      pendingNavRef.current = action;
      setShowUnsavedModal(true);
    } else {
      void action();
    }
  };

  const resolveUnsaved = async (choice: UnsavedChoice) => {
    if (choice === 'cancel') { pendingNavRef.current = null; setShowUnsavedModal(false); return; }
    if (choice === 'save') await handleSave();
    else setIsDirty(false);
    setShowUnsavedModal(false);
    const action = pendingNavRef.current;
    pendingNavRef.current = null;
    if (action) await action();
  };

  const dismissModals = useCallback(() => {
    if (showUnsavedModal) {
      void resolveUnsaved('cancel');
      return;
    }
    setShowSaveAsModal(false);
    setShowMarkdownSaveAsModal(false);
    setShowProtectModal(false);
    setShowSignModal(false);
    setShowMetadataModal(false);
    setShowPasswordModal(false);
    setPendingEncryptedPath('');
    setPdfPasswordDraft('');
    setShowOpenModal(false);
    setShowBrowserModal(false);
    setShowDeleteModal(false);
    setShowSplitModal(false);
    setShowExtractModal(false);
    setShowExportPngModal(false);
    setShowDeleteRangeModal(false);
    setShowPageNumbersModal(false);
    setShowWatermarkModal(false);
    setShowCropModal(false);
    setShowFlattenModal(false);
    setShowAddBookmarkModal(false);
    setShowRenameBookmarkModal(false);
    setShowDuplicateRangeModal(false);
    setShowPageHeaderModal(false);
    setShowPageFooterModal(false);
    setShowSwapPagesModal(false);
    setShowReplacePageModal(false);
    setShowInterleaveModal(false);
    setShowPageSizeModal(false);
    setShowDecryptModal(false);
    setShowRotateRangeModal(false);
    setShowKeepRangeModal(false);
    setShowMoveRangeModal(false);
    setShowPrependModal(false);
    setShowSplitEveryModal(false);
    setShowPageBorderModal(false);
    setShowBookmarkAllModal(false);
    setShowExpandMarginsModal(false);
    setShowReverseRangeModal(false);
    setShowInsertBlankPagesModal(false);
    setShowCropRangeModal(false);
    setShowExportPagesPdfModal(false);
    setShowInsertImagePageModal(false);
    setShowExportPagePdfModal(false);
    setShowInsertModal(false);
    setInsertFilePath('');
    setShowMergeModal(false);
    setMergeFilePath('');
    setShowSearchModal(false);
    setActiveSearchRect(null);
    setShowImageInsertModal(false);
    setShowAddFormFieldModal(false);
    setShowSummaryModal(false);
    setShowPageTextModal(false);
    setEditingTextIndex(null);
    setPendingTextPos(null);
    setShowPageEditsModal(false);
    setShowCommandPalette(false);
    setShowShortcutsHelp(false);
    setShowLicenses(false);
    setShowCredits(false);
    setShowAbout(false);
    setShowTesseractModal(false);
  }, [showUnsavedModal]);

  const undoRedoRef = useRef({ undo, redo });
  undoRedoRef.current = { undo, redo };
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const openSaveAsRef = useRef(openSaveAs);
  openSaveAsRef.current = openSaveAs;
  const canUndoRef = useRef(canUndo);
  const canRedoRef = useRef(canRedo);
  const hasOpenPdfRef = useRef(!!filePath);
  canUndoRef.current = canUndo;
  canRedoRef.current = canRedo;
  hasOpenPdfRef.current = !!filePath;
  const highlightModeRef = useRef(highlightMode);
  highlightModeRef.current = highlightMode;
  const noteModeRef = useRef(noteMode);
  noteModeRef.current = noteMode;
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  const shapeModeRef = useRef(shapeMode);
  shapeModeRef.current = shapeMode;
  const stampModeRef = useRef(stampMode);
  stampModeRef.current = stampMode;
  const redactModeRef = useRef(redactMode);
  redactModeRef.current = redactMode;
  const imageInsertModeRef = useRef(imageInsertMode);
  imageInsertModeRef.current = imageInsertMode;
  const textEditModeRef = useRef(textEditMode);
  textEditModeRef.current = textEditMode;
  const vectorEditModeRef = useRef(vectorEditMode);
  vectorEditModeRef.current = vectorEditMode;
  const exitTextEditModeRef = useRef(exitTextEditMode);
  exitTextEditModeRef.current = exitTextEditMode;
  const exitVectorEditModeRef = useRef(exitVectorEditMode);
  exitVectorEditModeRef.current = exitVectorEditMode;
  const toggleTextEditModeRef = useRef(toggleTextEditMode);
  toggleTextEditModeRef.current = toggleTextEditMode;
  const toggleVectorEditModeRef = useRef(toggleVectorEditMode);
  toggleVectorEditModeRef.current = toggleVectorEditMode;
  const formAddModeRef = useRef(formAddMode);
  formAddModeRef.current = formAddMode;
  const exitHighlightModeRef = useRef(exitHighlightMode);
  exitHighlightModeRef.current = exitHighlightMode;
  const exitNoteModeRef = useRef(exitNoteMode);
  exitNoteModeRef.current = exitNoteMode;
  const exitDrawModeRef = useRef(exitDrawMode);
  exitDrawModeRef.current = exitDrawMode;
  const exitShapeModeRef = useRef(exitShapeMode);
  exitShapeModeRef.current = exitShapeMode;
  const exitStampModeRef = useRef(exitStampMode);
  exitStampModeRef.current = exitStampMode;
  const exitRedactModeRef = useRef(exitRedactMode);
  exitRedactModeRef.current = exitRedactMode;
  const exitImageInsertModeRef = useRef(exitImageInsertMode);
  exitImageInsertModeRef.current = exitImageInsertMode;
  const exitFormAddModeRef = useRef(exitFormAddMode);
  exitFormAddModeRef.current = exitFormAddMode;
  const toggleFormsPanelRef = useRef(toggleFormsPanel);
  toggleFormsPanelRef.current = toggleFormsPanel;
  const toggleNoteModeRef = useRef(toggleNoteMode);
  toggleNoteModeRef.current = toggleNoteMode;
  const goToPageRef = useRef(goToPage);
  goToPageRef.current = goToPage;
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const toggleHighlightModeRef = useRef(toggleHighlightMode);
  toggleHighlightModeRef.current = toggleHighlightMode;
  const toggleDrawModeRef = useRef(toggleDrawMode);
  toggleDrawModeRef.current = toggleDrawMode;
  const toggleShapeModeRef = useRef(toggleShapeMode);
  toggleShapeModeRef.current = toggleShapeMode;
  const toggleStampModeRef = useRef(toggleStampMode);
  toggleStampModeRef.current = toggleStampMode;
  const toggleRedactModeRef = useRef(toggleRedactMode);
  toggleRedactModeRef.current = toggleRedactMode;
  const toggleImageInsertModeRef = useRef(toggleImageInsertMode);
  toggleImageInsertModeRef.current = toggleImageInsertMode;
  const zoomInRef = useRef(zoomIn);
  zoomInRef.current = zoomIn;
  const zoomOutRef = useRef(zoomOut);
  zoomOutRef.current = zoomOut;
  const resetZoomRef = useRef(resetZoom);
  resetZoomRef.current = resetZoom;
  const requestClosePdfRef = useRef<() => void>(() => {});
  const openPdfRef = useRef(openPdf);
  openPdfRef.current = openPdf;
  const handlePrintRef = useRef(async () => {});
  const handleRotatePageRef = useRef(handleRotatePage);
  handleRotatePageRef.current = handleRotatePage;
  const handleDuplicatePageRef = useRef(handleDuplicatePage);
  handleDuplicatePageRef.current = handleDuplicatePage;
  const toggleMarkdownViewRef = useRef(async () => {});
  const openDeleteModalRef = useRef(openDeleteModal);
  openDeleteModalRef.current = openDeleteModal;
  const openInsertModalRef = useRef(openInsertModal);
  openInsertModalRef.current = openInsertModal;
  const openSplitModalRef = useRef(openSplitModal);
  openSplitModalRef.current = openSplitModal;
  const openExtractModalRef = useRef(openExtractModal);
  openExtractModalRef.current = openExtractModal;
  const openExportPngModalRef = useRef(openExportPngModal);
  openExportPngModalRef.current = openExportPngModal;
  const handleReversePagesRef = useRef(handleReversePages);
  handleReversePagesRef.current = handleReversePages;
  const handleAddBlankPageRef = useRef(handleAddBlankPage);
  handleAddBlankPageRef.current = handleAddBlankPage;
  const openDeleteRangeModalRef = useRef(openDeleteRangeModal);
  openDeleteRangeModalRef.current = openDeleteRangeModal;
  const openPageNumbersModalRef = useRef(openPageNumbersModal);
  openPageNumbersModalRef.current = openPageNumbersModal;
  const openWatermarkModalRef = useRef(openWatermarkModal);
  openWatermarkModalRef.current = openWatermarkModal;
  const openCropModalRef = useRef(openCropModal);
  openCropModalRef.current = openCropModal;
  const openFlattenModalRef = useRef(openFlattenModal);
  openFlattenModalRef.current = openFlattenModal;
  const openMergeModalRef = useRef(openMergeModal);
  openMergeModalRef.current = openMergeModal;
  const openSearchModalRef = useRef(openSearchModal);
  openSearchModalRef.current = openSearchModal;
  const runPdfSearchRef = useRef(runPdfSearch);
  runPdfSearchRef.current = runPdfSearch;
  const stepSearchMatchRef = useRef(stepSearchMatch);
  stepSearchMatchRef.current = stepSearchMatch;
  const handleOptimizePdfRef = useRef(async () => {});
  const handleSummarizePdfRef = useRef(async () => {});
  const openSignModalRef = useRef<() => void>(() => {});
  const dismissModalsRef = useRef(dismissModals);
  dismissModalsRef.current = dismissModals;
  const anyModalOpenRef = useRef(false);
  anyModalOpenRef.current =
    showUnsavedModal || showSaveAsModal || showMarkdownSaveAsModal || showProtectModal || showSignModal || showMetadataModal
    || showPasswordModal || showOpenModal || showBrowserModal || showDeleteModal
    || showSplitModal || showExtractModal || showExportPngModal || showDeleteRangeModal
    || showPageNumbersModal || showWatermarkModal || showCropModal || showFlattenModal || showAddBookmarkModal
    || showRenameBookmarkModal || showDuplicateRangeModal || showPageHeaderModal || showPageFooterModal
    || showSwapPagesModal || showReplacePageModal || showInterleaveModal || showPageSizeModal || showDecryptModal
    || showRotateRangeModal || showKeepRangeModal || showMoveRangeModal || showPrependModal || showSplitEveryModal
    || showPageBorderModal || showBookmarkAllModal || showExpandMarginsModal || showShrinkMarginsModal
    || showDeleteNthModal || showExtractOddModal || showExtractEvenModal || showSplitAtModal
    || showReverseRangeModal || showInsertBlankPagesModal || showCropRangeModal || showParityRangeModal
    || showExportPagesPdfModal
    || showInsertImagePageModal || showExportPagePdfModal
    || showInsertModal || showMergeModal || showSearchModal
    || showNoteModal || showImageInsertModal
    || showAddFormFieldModal || showSummaryModal || showPageTextModal || showPageEditsModal
    || showCommandPalette || showShortcutsHelp || showLicenses || showCredits || showAbout || showTesseractModal;

  useEffect(() => {
    const isTextInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openPdfRef.current();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      if (e.key === 'Escape') {
        if (noteModeRef.current && hasOpenPdfRef.current) {
          exitNoteModeRef.current();
          return;
        }
        if (drawModeRef.current && hasOpenPdfRef.current) {
          exitDrawModeRef.current();
          return;
        }
        if (shapeModeRef.current && hasOpenPdfRef.current) {
          exitShapeModeRef.current();
          return;
        }
        if (stampModeRef.current && hasOpenPdfRef.current) {
          exitStampModeRef.current();
          return;
        }
        if (redactModeRef.current && hasOpenPdfRef.current) {
          exitRedactModeRef.current();
          return;
        }
        if (imageInsertModeRef.current && hasOpenPdfRef.current) {
          exitImageInsertModeRef.current();
          return;
        }
        if (textEditModeRef.current && hasOpenPdfRef.current) {
          exitTextEditModeRef.current();
          return;
        }
        if (vectorEditModeRef.current && hasOpenPdfRef.current) {
          exitVectorEditModeRef.current();
          return;
        }
        if (formAddModeRef.current && hasOpenPdfRef.current) {
          exitFormAddModeRef.current();
          return;
        }
        if (highlightModeRef.current && hasOpenPdfRef.current) {
          exitHighlightModeRef.current();
          return;
        }
        if (anyModalOpenRef.current) {
          dismissModalsRef.current();
          return;
        }
      }

      if (!hasOpenPdfRef.current) return;

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const count = pageCountRef.current;
        const page = currentPageRef.current;
        if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && page > 0) {
          e.preventDefault();
          goToPageRef.current(page - 1);
          return;
        }
        if ((e.key === 'ArrowRight' || e.key === 'PageDown') && count !== null && page < count - 1) {
          e.preventDefault();
          goToPageRef.current(page + 1);
          return;
        }
        if (e.key.toLowerCase() === 'h' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleHighlightModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'n' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleNoteModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'd' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleDrawModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 's' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleShapeModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 't' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleStampModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'x' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleRedactModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'e' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleTextEditModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'g' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleVectorEditModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'i' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleImageInsertModeRef.current();
          return;
        }
        if (e.key.toLowerCase() === 'f' && viewModeRef.current === 'pdf') {
          e.preventDefault();
          toggleFormsPanelRef.current();
          return;
        }
        if (e.key === 'Home' && page > 0) {
          e.preventDefault();
          goToPageRef.current(0);
          return;
        }
        if (e.key === 'End' && count !== null && page < count - 1) {
          e.preventDefault();
          goToPageRef.current(count - 1);
          return;
        }
        if (e.key === 'Delete' && count !== null && count > 1) {
          e.preventDefault();
          openDeleteModalRef.current();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey) return;

      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) openSaveAsRef.current();
        else if (isDirtyRef.current) void handleSaveRef.current();
        return;
      }
      if (key === 'w') {
        e.preventDefault();
        requestClosePdfRef.current();
        return;
      }
      if (key === 'p') {
        e.preventDefault();
        void handlePrintRef.current();
        return;
      }
      if (key === 'r') {
        e.preventDefault();
        void handleRotatePageRef.current();
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        openSearchModalRef.current();
        return;
      }
      if (key === 'd' && e.shiftKey) {
        e.preventDefault();
        void handleDuplicatePageRef.current();
        return;
      }
      if (key === 'm' && e.shiftKey) {
        e.preventDefault();
        void toggleMarkdownViewRef.current();
        return;
      }
      if (key === 'o' && e.shiftKey) {
        e.preventDefault();
        void handleOptimizePdfRef.current();
        return;
      }
      if (key === 'e' && e.shiftKey) {
        e.preventDefault();
        void handleSummarizePdfRef.current();
        return;
      }
      if (key === 'u' && e.shiftKey) {
        e.preventDefault();
        openSignModalRef.current();
        return;
      }
      if (key === 'i' && e.shiftKey) {
        e.preventDefault();
        openInsertModalRef.current();
        return;
      }
      if (key === 'k' && e.shiftKey) {
        e.preventDefault();
        openSplitModalRef.current();
        return;
      }
      if (key === 'j' && e.shiftKey) {
        e.preventDefault();
        openExtractModalRef.current();
        return;
      }
      if (key === 'b' && e.shiftKey) {
        e.preventDefault();
        openExportPngModalRef.current();
        return;
      }
      if (key === 'n' && e.shiftKey) {
        e.preventDefault();
        void handleAddBlankPageRef.current();
        return;
      }
      if (key === 'y' && e.shiftKey) {
        e.preventDefault();
        void handleReversePagesRef.current();
        return;
      }
      if (key === 'g' && e.shiftKey) {
        e.preventDefault();
        openMergeModalRef.current();
        return;
      }
      if (key === '=' || key === '+') {
        e.preventDefault();
        zoomInRef.current();
        return;
      }
      if (key === '-') {
        e.preventDefault();
        zoomOutRef.current();
        return;
      }
      if (key === '0') {
        e.preventDefault();
        resetZoomRef.current();
        return;
      }
      if (key === 'z' && !e.shiftKey && canUndoRef.current) {
        e.preventDefault();
        void undoRedoRef.current.undo();
        return;
      }
      if (canRedoRef.current && ((key === 'y' && !e.shiftKey) || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        void undoRedoRef.current.redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const closePdf = () => {
    if (filePath) void invoke('discard_working_copy', { working: filePath }).catch(() => {});
    discardHistory();
    cancelDrawing();
    setFilePath('');
    setOriginalPath('');
    setIsDirty(false);
    setPageCount(null);
    setCurrentPage(0);
    setPageInput('1');
    setZoom(1);
    setViewMode('pdf');
    setMarkdownText('');
    setMarkdownPath('');
    setMarkdownOcrNotice(null);
    setPdfRevision(0);
    setMarkdownRevision(null);
    setHighlightMode(false);
    setImageInsertMode(false);
    setFormAddMode(false);
    setImageSourcePath('');
    setShowImageInsertModal(false);
    setShowFormsPanel(false);
    setShowSignaturesPanel(false);
    setShowBookmarksPanel(false);
    setPdfBookmarks([]);
    setPageSizes([]);
    setPdfSignatures([]);
    setSignatureVerification(null);
    setShowSignModal(false);
    setShowMetadataModal(false);
    setFormFields([]);
    setFormDrafts({});
    setShowAddFormFieldModal(false);
    setNewFormFieldName('');
    setNewFormFieldKind('text');
    setNewFormFieldOptions('Option A, Option B');
    setNewFormRadioGroup('');
    setNewFormRadioOption('');
    setNewFormCheckboxChecked(false);
    setShowDeleteModal(false);
    revokeViewerAssets();
    setPrintPages((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    showToast('PDF closed');
  };
  requestClosePdfRef.current = () => guardUnsaved(closePdf);

  const saveMarkdownToPath = async (target: string, switchToMarkdown: boolean) => {
    if (!filePath || !target) return;
    let result = await invoke<MarkdownSaveResult>('save_pdf_markdown', {
      path: filePath,
      overwrite: false,
      outputPath: target,
    });
    if (result.conflict) {
      const overwrite = window.confirm('Overwrite Markdown File?');
      if (!overwrite) return;
      result = await invoke<MarkdownSaveResult>('save_pdf_markdown', {
        path: filePath,
        overwrite: true,
        outputPath: target,
      });
    }
    setMarkdownText(result.markdown);
    setMarkdownPath(result.markdownPath);
    setMarkdownRevision(pdfRevision);
    setMarkdownOcrNotice(markdownOcrNoticeFromResult(result));
    if (switchToMarkdown) setViewMode('markdown');
    showToast(markdownSaveToastMessage(result));
  };

  const handleMarkdownView = async () => {
    if (!filePath) return;
    if (markdownText && markdownRevision === pdfRevision) {
      setViewMode('markdown');
      return;
    }
    await withLoading(async () => {
      await saveMarkdownToPath(siblingMarkdownPath(originalPath || filePath), true);
    });
  };

  const toggleMarkdownView = async () => {
    if (!filePath) return;
    if (viewMode === 'markdown') {
      setViewMode('pdf');
      return;
    }
    if (shouldShowTesseractReminder()) {
      setTesseractReminderSource('markdown');
      setShowTesseractModal(true);
      return;
    }
    await handleMarkdownView();
  };
  toggleMarkdownViewRef.current = toggleMarkdownView;
  handleMarkdownViewRef.current = handleMarkdownView;

  const handleMarkdownSaveAs = async () => {
    const target = markdownSaveAsPath.trim();
    if (!filePath || !target) return;
    await withLoading(async () => {
      await saveMarkdownToPath(target, viewMode === 'markdown');
      setShowMarkdownSaveAsModal(false);
    });
  };

  const markdownSaveAsViaNativeDialog = async () => {
    if (!filePath) return;
    const defaultPath = markdownPath || siblingMarkdownPath(originalPath || filePath);
    const picked = await pickSaveWithNativeDialog(markdownSaveAsPath || defaultPath, MARKDOWN_DIALOG_FILTER);
    if (!picked) return;
    const target = ensureExtension(picked, 'md');
    await withLoading(async () => {
      await saveMarkdownToPath(target, viewMode === 'markdown');
      setShowMarkdownSaveAsModal(false);
    });
  };

  const chooseMarkdownSaveAsNative = async () => {
    const defaultPath = markdownPath || siblingMarkdownPath(originalPath || filePath);
    const picked = await pickSaveWithNativeDialog(markdownSaveAsPath || defaultPath, MARKDOWN_DIALOG_FILTER);
    if (!picked) return;
    setMarkdownSaveAsPath(ensureExtension(picked, 'md'));
  };

  const openMarkdownSaveAs = () => {
    if (nativeDialogs) {
      void markdownSaveAsViaNativeDialog();
      return;
    }
    const defaultPath = markdownPath || siblingMarkdownPath(originalPath || filePath);
    setMarkdownSaveAsPath(defaultPath);
    setShowMarkdownSaveAsModal(true);
  };

  const handleSummarizePdf = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      const summary = await invoke<PdfSummaryResult>('summarize_pdf', { path: filePath });
      setPdfSummary(summary);
      setShowSummaryModal(true);
    });
  };

  const handleCopySummary = async () => {
    if (!pdfSummary) return;
    try {
      await navigator.clipboard.writeText(formatSummaryMarkdown(pdfSummary));
      showToast('Summary copied');
    } catch {
      showToast('Could not copy summary', 'error');
    }
  };

  const handleSaveSummary = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      let result = await invoke<SummarySaveResult>('save_pdf_summary', { path: filePath, overwrite: false });
      if (result.conflict) {
        const overwrite = window.confirm('Overwrite existing summary file?');
        if (!overwrite) return;
        result = await invoke<SummarySaveResult>('save_pdf_summary', { path: filePath, overwrite: true });
      }
      setPdfSummary(result.summary);
      showToast(result.written ? `Summary saved to ${result.summaryPath}` : 'Summary already saved');
    });
  };
  handleSummarizePdfRef.current = handleSummarizePdf;

  const handleSplitPdf = async () => {
    if (!filePath || !splitRanges) return;
    await withLoading(async () => {
      const ranges = splitRanges.split(',').map((r) => {
        const [start, end] = r.trim().split('-').map((n) => parseInt(n.trim(), 10) - 1);
        return [start, end] as [number, number];
      });
      const outputPaths = await invoke<string[]>('split_pdf', { path: filePath, pageRanges: ranges });
      showToast(`PDF split into ${outputPaths.length} file(s)`);
      setShowSplitModal(false);
      setSplitRanges('');
    });
  };

  const handleExtractPdf = async () => {
    const output = extractOutputPath.trim();
    if (!filePath || !output) return;
    const range = extractRange.validate();
    if (!range) return;
    await withLoading(async () => {
      const written = await invoke<string>('extract_pdf_pages', {
        path: filePath,
        outputPath: output,
        startPage: extractRange.startPage,
        endPage: extractRange.endPage,
      });
      showToast(`Extracted pages to ${written}`);
      setShowExtractModal(false);
    });
  };

  const chooseExtractOutputNative = async () => {
    const picked = await pickSaveWithNativeDialog(
      extractOutputPath || defaultExtractOutputPath(extractRange.startPage, extractRange.endPage),
      PDF_DIALOG_FILTER,
    );
    if (!picked) return;
    setExtractOutputPath(ensureExtension(picked, 'pdf'));
  };

  const handleInsertPdf = async () => {
    if (!filePath || !insertFilePath) return;
    if (!insertRange.validate()) return;
    await withLoading(async () => {
      await invoke('insert_pdf', {
        path: filePath,
        insertPath: insertFilePath,
        atIndex: insertAtPage,
        insertStart: insertRange.startPage,
        insertEnd: insertRange.endPage,
      });
      markPdfEdited();
      showToast('PDF inserted successfully');
      setShowInsertModal(false);
      setInsertFilePath('');
      setInsertAtPage(0);
      insertRange.reset(0, 0);
      await loadThumbnails(filePath);
      const count = await invoke<number>('get_pdf_page_count', { path: filePath });
      setPageCount(count);
    });
  };

  const handleMergePdf = async () => {
    if (!filePath || !mergeFilePath) return;
    if (!mergeRange.validate()) return;
    await withLoading(async () => {
      const added = await invoke<number>('merge_pdf', {
        path: filePath,
        mergePath: mergeFilePath,
        mergeStart: mergeRange.startPage,
        mergeEnd: mergeRange.endPage,
      });
      markPdfEdited();
      showToast(`Merged ${added} page${added === 1 ? '' : 's'} from source PDF`);
      setShowMergeModal(false);
      setMergeFilePath('');
      mergeRange.reset(0, 0);
      await loadThumbnails(filePath);
      const count = await invoke<number>('get_pdf_page_count', { path: filePath });
      setPageCount(count);
    });
  };

  const handleOptimizePdf = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      const result = await invoke<string>('optimize_pdf', { path: filePath });
      showToast(result);
    });
  };
  handleOptimizePdfRef.current = handleOptimizePdf;

  const openProtectModal = () => {
    setProtectUserPassword('');
    setProtectUserPasswordConfirm('');
    setProtectOwnerPassword('');
    setShowProtectModal(true);
  };

  const openMetadataModal = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      const metadata = await invoke<PdfDocumentMetadata>('get_pdf_metadata', { path: filePath });
      setMetadataTitle(metadata.title ?? '');
      setMetadataAuthor(metadata.author ?? '');
      setMetadataSubject(metadata.subject ?? '');
      setMetadataKeywords(metadata.keywords ?? '');
      setMetadataCreator(metadata.creator ?? '');
      setMetadataProducer(metadata.producer ?? '');
      setMetadataCreationDate(metadata.creation_date ?? '');
      setMetadataModDate(metadata.mod_date ?? '');
      setShowMetadataModal(true);
    });
  };

  const handleSaveMetadata = async () => {
    await runEdit({
      command: 'set_pdf_metadata',
      args: {
        title: metadataTitle.trim() || null,
        author: metadataAuthor.trim() || null,
        subject: metadataSubject.trim() || null,
        keywords: metadataKeywords.trim() || null,
        creator: metadataCreator.trim() || null,
        producer: metadataProducer.trim() || null,
      },
      skipReload: true,
      toast: 'Document metadata updated',
      onSuccess: () => setShowMetadataModal(false),
    });
  };

  const handleProtectPdf = async () => {
    if (!filePath) return;
    const userPassword = protectUserPassword;
    const confirm = protectUserPasswordConfirm;
    if (!userPassword) {
      showToast('User password is required', 'error');
      return;
    }
    if (userPassword !== confirm) {
      showToast('Passwords do not match', 'error');
      return;
    }
    const ownerPassword = protectOwnerPassword.trim();
    await withLoading(async () => {
      const result = await invoke<string>('protect_pdf', {
        path: filePath,
        userPassword,
        ownerPassword: ownerPassword || null,
      });
      setShowProtectModal(false);
      showToast(result);
    });
  };

  const openSignModal = () => {
    setSignCertPath('');
    setSignCertPassword('');
    setSignReason('');
    setSignLocation('');
    setShowSignModal(true);
  };

  const chooseSignCertNative = async () => {
    const selected = await openNativeDialog({
      multiple: false,
      directory: false,
      filters: CERT_DIALOG_FILTER,
    });
    if (selected === null) return;
    const path = typeof selected === 'string' ? selected : selected[0] ?? '';
    if (path) setSignCertPath(path);
  };

  const handleSignPdf = async () => {
    if (!filePath) return;
    const certPath = signCertPath.trim();
    if (!certPath) {
      showToast('Choose a PKCS#12 certificate (.p12/.pfx)', 'error');
      return;
    }
    if (!signCertPassword) {
      showToast('Certificate password is required', 'error');
      return;
    }
    await withLoading(async () => {
      const result = await invoke<string>('sign_pdf', {
        path: filePath,
        certPath,
        certPassword: signCertPassword,
        reason: signReason.trim() || null,
        location: signLocation.trim() || null,
        fieldName: null,
        outputPath: null,
      });
      markPdfEdited();
      setShowSignModal(false);
      setPdfRevision((r) => r + 1);
      await loadPdfSignatures(filePath);
      showToast(result);
    });
  };

  const toggleSignaturesPanel = () => setShowSignaturesPanel((prev) => !prev);
  openSignModalRef.current = openSignModal;

  const handlePrint = async () => {
    if (!filePath || pageCount === null) return;
    await withLoading(async () => {
      const urls: string[] = [];
      for (let i = 0; i < pageCount; i++) {
        const bytes = await invoke<number[]>('render_pdf_page', {
          path: filePath, pageIndex: i, width: 1000, height: 1414,
        });
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
        urls.push(URL.createObjectURL(blob));
      }
      setPrintPages(urls);
    });
  };
  handlePrintRef.current = handlePrint;

  // Once the print pages are in the DOM, open the native print dialog, then
  // clean up the object URLs.
  useEffect(() => {
    if (printPages.length === 0) return;
    const timer = setTimeout(() => {
      window.print();
      printPages.forEach((url) => URL.revokeObjectURL(url));
      setPrintPages([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [printPages]);

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
    <div className="app">
      <TitleBar title={windowTitle} />
      <Toast notification={toast} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
        </div>
      )}

      <div className="app-chrome">
        <MenuChrome
          menus={appMenus.menus}
          quickAccess={appMenus.quickAccess}
          allActions={appMenus.allActions}
          showCommandPalette={showCommandPalette}
          showShortcutsHelp={showShortcutsHelp}
          showLicenses={showLicenses}
          showCredits={showCredits}
          showAbout={showAbout}
          onCloseCommandPalette={() => setShowCommandPalette(false)}
          onCloseShortcutsHelp={() => setShowShortcutsHelp(false)}
          onCloseLicenses={() => setShowLicenses(false)}
          onCloseCredits={() => setShowCredits(false)}
          onCloseAbout={() => setShowAbout(false)}
          modeExtras={modeToolbarExtras}
        />

        {pageCount !== null && viewMode === 'pdf' && (
          <PageControls
            pageCount={pageCount}
            currentPage={currentPage}
            pageInput={pageInput}
            pageSizes={pageSizes}
            onPageInputChange={setPageInput}
            onCommitPage={commitPage}
            onGoToPage={goToPage}
            zoom={zoom}
            zoomInput={zoomInput}
            onZoomInputChange={setZoomInput}
            onCommitZoom={commitZoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetZoom={resetZoom}
          />
        )}
      </div>

      <AppBody
        filePath={filePath}
        sidebar={{
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
        }}
        viewer={{
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
        }}
      />

      <AppModals ctx={modalCtx} />

      {/* Print surface — hidden on screen, shown only by the print stylesheet */}
      <div className="print-root">
        {printPages.map((src, i) => (
          <img key={i} src={src} className="print-page" alt={`Print page ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

export default App;
