import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openNativeDialog, save as saveNativeDialog } from '@tauri-apps/plugin-dialog';

// Base resolution each page is rendered at. Zoom is applied as a CSS transform
// on top of this so the rendered image and the annotation overlays scale
// together and stay aligned at any zoom level.
const BASE_W = 800;
const BASE_H = 1132;

const MIN_ZOOM = 0.25; // 25%
const MAX_ZOOM = 4; // 400%
const ZOOM_STEP = 0.25;

// Cooldown (ms) between wheel-driven page changes so one scroll gesture / inertia
// doesn't skip several pages at once.
const WHEEL_NAV_COOLDOWN = 350;

const RECENT_PDFS_KEY = 'pdf-panda:recent-pdfs';
const LAST_BROWSER_DIR_KEY = 'pdf-panda:last-browser-dir';
const RECENT_PDF_LIMIT = 8;
// Cap undo snapshots so very large PDFs don't accumulate unbounded working copies.
const MAX_UNDO_HISTORY = 50;
// Above this size, per-edit snapshots store compact binary deltas instead of full copies.
const SNAPSHOT_BYTE_LIMIT = 32 * 1024 * 1024;

interface HistorySnapshot {
  kind: 'full' | 'delta';
  path: string;
  baseIndex?: number;
  size: number;
}

type ShapeKind = 'square' | 'circle' | 'line';
type StampKind = 'text' | 'image';
type FormFieldKind = 'text' | 'checkbox' | 'choice' | 'radio';

const STAMP_PRESETS = [
  { id: 'approved', label: 'APPROVED', color: '#228b22' },
  { id: 'draft', label: 'DRAFT', color: '#787878' },
  { id: 'confidential', label: 'CONFIDENTIAL', color: '#b22222' },
  { id: 'reviewed', label: 'REVIEWED', color: '#1e5aa0' },
] as const;

interface AnnotationData {
  subtype: string;
  rect: [number, number, number, number];
  color: [number, number, number] | null;
  contents: string | null;
  ink_points: number[] | null;
  line_endpoints: [number, number, number, number] | null;
  stamp_kind: string | null;
  stamp_preset: string | null;
  is_redaction: boolean;
}

interface FormFieldData {
  name: string;
  field_type: string;
  value: string;
  page_index: number | null;
  rect: [number, number, number, number] | null;
  options: string[];
  checked: boolean;
}

function stampPresetMeta(preset: string | null | undefined) {
  return STAMP_PRESETS.find((entry) => entry.id === preset);
}

function shapeStrokeColor(color: [number, number, number] | null): string {
  if (!color) return 'rgb(255,0,0)';
  return `rgb(${color[0] * 255},${color[1] * 255},${color[2] * 255})`;
}

function inkPointsToPolyline(points: number[] | null | undefined): string {
  if (!points || points.length < 2) return '';
  const pairs: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push(`${points[i]},${points[i + 1]}`);
  }
  return pairs.join(' ');
}

type ViewMode = 'pdf' | 'markdown';

interface MarkdownSaveResult {
  markdown: string;
  markdownPath: string;
  written: boolean;
  conflict: boolean;
}

interface PdfTextSearchMatch {
  page_index: number;
  match_index: number;
  rect: [number, number, number, number];
}

interface PdfIntelligentExtraction {
  headings: string[];
  emails: string[];
  urls: string[];
  dates: string[];
}

interface PdfSummaryResult {
  pageCount: number;
  wordCount: number;
  titleGuess: string | null;
  overview: string;
  keyPoints: string[];
  extraction: PdfIntelligentExtraction;
  scannedPages: number;
}

interface SummarySaveResult {
  summary: PdfSummaryResult;
  summaryPath: string;
  written: boolean;
  conflict: boolean;
}

interface PageTextEdit {
  index: number;
  x: number;
  y: number;
  font_size: number;
  text: string;
}

interface PageVectorEdit {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
}

interface PdfSignatureInfo {
  field_name: string;
  signer_name: string | null;
  reason: string | null;
  location: string | null;
  signing_time: string | null;
  sub_filter: string | null;
  signed_percent: number | null;
}

interface PdfSignatureVerificationEntry {
  field_name: string;
  status: string;
  signer_name: string | null;
  signing_time: string | null;
  integrity_ok: boolean;
  modifications_after_signing: boolean;
  summary: string;
}

interface PdfSignatureVerificationSummary {
  signature_count: number;
  valid_count: number;
  invalid_count: number;
  document_modified: boolean;
  overall_valid: boolean;
  summary: string;
  signatures: PdfSignatureVerificationEntry[];
}

interface PdfBookmarkEntry {
  title: string;
  depth: number;
  page_index: number | null;
}

interface PdfDocumentMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  creation_date: string | null;
  mod_date: string | null;
}

type PdfBrowserTarget = 'open' | 'insert' | 'merge';

interface PdfBrowserEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface PdfBrowserListing {
  currentDir: string;
  parentDir: string | null;
  entries: PdfBrowserEntry[];
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const siblingMarkdownPath = (pdfPath: string) => pdfPath.replace(/\.pdf$/i, '.md');

const formatSummaryMarkdown = (summary: PdfSummaryResult): string => {
  const lines: string[] = ['# Document Summary', ''];
  if (summary.titleGuess) lines.push(`**Title guess:** ${summary.titleGuess}`, '');
  lines.push(
    `**Pages:** ${summary.pageCount} · **Words:** ${summary.wordCount} · **Scanned/image-only pages:** ${summary.scannedPages}`,
    '',
    '## Overview',
    '',
    summary.overview,
    '',
    '## Key points',
    '',
  );
  if (summary.keyPoints.length === 0) lines.push('_(none)_', '');
  else summary.keyPoints.forEach((point) => lines.push(`- ${point}`));
  lines.push('', '## Extracted headings', '');
  if (summary.extraction.headings.length === 0) lines.push('_(none)_', '');
  else summary.extraction.headings.forEach((heading) => lines.push(`- ${heading}`));
  lines.push('', '## Emails', '');
  if (summary.extraction.emails.length === 0) lines.push('_(none)_', '');
  else summary.extraction.emails.forEach((email) => lines.push(`- ${email}`));
  lines.push('', '## URLs', '');
  if (summary.extraction.urls.length === 0) lines.push('_(none)_', '');
  else summary.extraction.urls.forEach((url) => lines.push(`- ${url}`));
  lines.push('', '## Dates', '');
  if (summary.extraction.dates.length === 0) lines.push('_(none)_');
  else summary.extraction.dates.forEach((date) => lines.push(`- ${date}`));
  return lines.join('\n');
};

const readStoredString = (key: string): string => {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const readStoredStringArray = (key: string): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const writeStoredString = (key: string, value: string) => {
  try {
    if (value) window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in restricted webviews; persistence is optional.
  }
};

const writeStoredStringArray = (key: string, value: string[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be unavailable in restricted webviews; persistence is optional.
  }
};

const directoryFromPath = (path: string): string => {
  const trimmed = path.trim();
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slash > 0 ? trimmed.slice(0, slash) : '';
};

const fileNameFromPath = (path: string): string => {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const PDF_DIALOG_FILTER = [{ name: 'PDF', extensions: ['pdf'] }];
const MARKDOWN_DIALOG_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];
const CERT_DIALOG_FILTER = [{ name: 'PKCS#12', extensions: ['p12', 'pfx'] }];

const signatureStatusLabel = (status: string): string => {
  switch (status) {
    case 'valid':
      return 'Valid (trusted)';
    case 'valid_untrusted':
      return 'Valid (untrusted CA)';
    case 'invalid':
      return 'Invalid';
    case 'indeterminate':
      return 'Indeterminate';
    default:
      return status;
  }
};

const ensureExtension = (path: string, extension: string): string => {
  const lower = path.toLowerCase();
  const suffix = `.${extension}`;
  return lower.endsWith(suffix) ? path : `${path}${suffix}`;
};

const pickPdfWithNativeDialog = async (defaultPath?: string): Promise<string | null> => {
  const selected = await openNativeDialog({
    multiple: false,
    directory: false,
    defaultPath: defaultPath?.trim() || undefined,
    filters: PDF_DIALOG_FILTER,
  });
  if (selected === null) return null;
  return typeof selected === 'string' ? selected : selected[0] ?? null;
};

const pickSaveWithNativeDialog = async (
  defaultPath: string,
  filters: { name: string; extensions: string[] }[],
): Promise<string | null> => saveNativeDialog({
  defaultPath: defaultPath.trim() || undefined,
  filters,
});

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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<HistorySnapshot[]>([]); // historyRef[histIdx] == current working state
  const histIdxRef = useRef(0);
  const savedIdxRef = useRef(0); // history index matching the last saved/opened state
  const filePathRef = useRef('');
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [imageSrc, setImageSrc] = useState<string>('');
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('pdf');
  const [markdownText, setMarkdownText] = useState('');
  const [markdownPath, setMarkdownPath] = useState('');
  const [pdfRevision, setPdfRevision] = useState(0);
  const [markdownRevision, setMarkdownRevision] = useState<number | null>(null);

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
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [highlightStart, setHighlightStart] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [inkDrawing, setInkDrawing] = useState(false);
  const [inkDraft, setInkDraft] = useState<number[]>([]);
  const [shapeLineEnd, setShapeLineEnd] = useState<{ x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const deltaSnapshotNotifiedRef = useRef(false);

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
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertFilePath, setInsertFilePath] = useState<string>('');
  const [insertAtPage, setInsertAtPage] = useState<number>(0);
  const [insertStartPage, setInsertStartPage] = useState<number>(0);
  const [insertEndPage, setInsertEndPage] = useState<number>(0);
  const [insertSourcePageCount, setInsertSourcePageCount] = useState<number | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeFilePath, setMergeFilePath] = useState('');
  const [mergeStartPage, setMergeStartPage] = useState(0);
  const [mergeEndPage, setMergeEndPage] = useState(0);
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
        setInsertStartPage(0);
        setInsertEndPage(Math.max(0, count - 1));
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
        setMergeStartPage(0);
        setMergeEndPage(Math.max(0, count - 1));
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

  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  useEffect(() => {
    void invoke<boolean>('native_file_dialogs_enabled')
      .then(setNativeDialogs)
      .catch(() => setNativeDialogs(false));
  }, []);

  const refreshUndoRedoState = useCallback(() => {
    setCanUndo(histIdxRef.current > 0);
    setCanRedo(histIdxRef.current < historyRef.current.length - 1);
    setIsDirty(histIdxRef.current !== savedIdxRef.current);
  }, []);

  const pruneUndoHistory = useCallback(async () => {
    while (historyRef.current.length > MAX_UNDO_HISTORY) {
      const dropAt = savedIdxRef.current === 0 ? 1 : 0;
      if (historyRef.current.length <= dropAt) break;
      try {
        historyRef.current = await invoke<HistorySnapshot[]>('prune_history_entry', {
          history: historyRef.current,
          dropIndex: dropAt,
        });
      } catch {
        /* best-effort */
      }
      if (histIdxRef.current > dropAt) histIdxRef.current -= 1;
      else if (histIdxRef.current === dropAt) histIdxRef.current = Math.max(0, dropAt - 1);
      if (savedIdxRef.current > dropAt) savedIdxRef.current -= 1;
    }
  }, []);

  // Snapshot the working copy into the undo history after an edit.
  const recordHistory = useCallback(async () => {
    const working = filePathRef.current;
    if (!working) return;
    try {
      const size = await invoke<number>('file_byte_size', { path: working });
      const snapshot = await invoke<HistorySnapshot>('snapshot_pdf_entry', {
        history: historyRef.current.slice(0, histIdxRef.current + 1),
        source: working,
      });
      if (size > SNAPSHOT_BYTE_LIMIT && snapshot.kind === 'delta' && !deltaSnapshotNotifiedRef.current) {
        deltaSnapshotNotifiedRef.current = true;
        showToast('Large file: using compact undo snapshots', 'success');
      }
      // Drop any redo branch we're overwriting.
      historyRef.current.slice(histIdxRef.current + 1).forEach((entry) => {
        void invoke('discard_history_entry', { entry }).catch(() => {});
      });
      historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
      historyRef.current.push(snapshot);
      histIdxRef.current = historyRef.current.length - 1;
      await pruneUndoHistory();
      refreshUndoRedoState();
    } catch {
      /* history is best-effort */
    }
  }, [pruneUndoHistory, refreshUndoRedoState, showToast]);

  const markPdfEdited = useCallback(() => {
    setPdfRevision((revision) => revision + 1);
    setViewMode('pdf');
    setIsDirty(true);
    void recordHistory();
  }, [recordHistory]);

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
      deltaSnapshotNotifiedRef.current = false;
      setIsDirty(false);
      // Reset undo/redo history with the freshly-opened state as the baseline.
      historyRef.current.forEach((entry) => void invoke('discard_history_entry', { entry }).catch(() => {}));
      const baseline = await invoke<HistorySnapshot>('snapshot_pdf_entry', { history: [], source: working });
      historyRef.current = [baseline];
      histIdxRef.current = 0;
      savedIdxRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
      setViewMode('pdf');
      setMarkdownText('');
      setMarkdownPath('');
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
    const startPath = target === 'open'
      ? lastBrowserDir || directoryFromPath(openFilePath) || directoryFromPath(originalPath)
      : directoryFromPath(target === 'insert' ? insertFilePath : mergeFilePath)
        || lastBrowserDir
        || directoryFromPath(originalPath);
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
    } else {
      setMergeFilePath(entry.path);
      rememberBrowserDirectory(entry.path);
    }
    setShowBrowserModal(false);
  };

  const loadThumbnails = async (path: string) => {
    const thumbBytesArray = await invoke<number[][]>('get_pdf_thumbnails', {
      path, width: 100, height: 141,
    });
    const thumbs = thumbBytesArray.map((bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      return URL.createObjectURL(blob);
    });
    setThumbnails((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return thumbs;
    });
  };

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

  const renderPage = async (path: string, index: number) => {
    const bytes = await invoke<number[]>('render_pdf_page', {
      path, pageIndex: index, width: BASE_W, height: BASE_H,
    });
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    setImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });

    const annots = await invoke<AnnotationData[]>('get_annotations', { path, pageIndex: index });
    setAnnotations(annots);
    await loadPageEdits(path, index);
  };

  // Navigate to a page (0-based), clamped to the document.
  const goToPage = (index: number) => {
    if (pageCount === null || !filePath) return;
    const clamped = Math.max(0, Math.min(index, pageCount - 1));
    setViewMode('pdf');
    setCurrentPage(clamped);
    const render = () => {
      void withLoading(() => renderPage(filePath, clamped));
    };
    if (viewMode === 'markdown') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(render));
      return;
    }
    render();
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
    if (!filePath) return;
    await withLoading(async () => {
      await invoke('rotate_page', { path: filePath, pageIndex: currentPage });
      markPdfEdited();
      await renderPage(filePath, currentPage);
      await loadThumbnails(filePath);
      showToast('Page rotated 90°');
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

  const cancelDrawing = () => {
    setDrawing(false);
    setHighlightStart(null);
    setHighlightRect(null);
    setInkDrawing(false);
    setInkDraft([]);
    setShapeLineEnd(null);
  };

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
      void withLoading(async () => {
        await invoke('add_redaction', {
          path: filePath,
          pageIndex: currentPage,
          x1: rect.x,
          y1: rect.y,
          x2: rect.x + rect.w,
          y2: rect.y + rect.h,
        });
        markPdfEdited();
        await refreshAnnotations();
        showToast('Redaction added');
      });
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
        void withLoading(async () => {
          await invoke('add_line', {
            path: filePath,
            pageIndex: currentPage,
            x1: start.x,
            y1: start.y,
            x2: coords.x,
            y2: coords.y,
          });
          markPdfEdited();
          await refreshAnnotations();
          showToast('Line added');
        });
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
    void withLoading(async () => {
      await invoke('add_highlight', {
        path: filePath,
        pageIndex: currentPage,
        x1: rect.x,
        y1: rect.y,
        x2: rect.x + rect.w,
        y2: rect.y + rect.h,
      });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Highlight added');
    });
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

  const removeRedaction = (index: number) => {
    void withLoading(async () => {
      await invoke('remove_redaction', { path: filePath, pageIndex: currentPage, index });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Redaction removed');
    });
  };

  const removeStamp = (kind: StampKind, index: number) => {
    const command = kind === 'text' ? 'remove_text_stamp' : 'remove_image_stamp';
    void withLoading(async () => {
      await invoke(command, { path: filePath, pageIndex: currentPage, index });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Stamp removed');
    });
  };

  const removeShape = (subtype: 'Square' | 'Circle' | 'Line', index: number) => {
    const command = subtype === 'Square' ? 'remove_square' : subtype === 'Circle' ? 'remove_circle' : 'remove_line';
    void withLoading(async () => {
      await invoke(command, { path: filePath, pageIndex: currentPage, index });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Shape removed');
    });
  };

  const commitInkStroke = (points: number[]) => {
    if (points.length < 4) return;
    void withLoading(async () => {
      await invoke('add_ink_stroke', {
        path: filePath,
        pageIndex: currentPage,
        points,
      });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Drawing added');
    });
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
    void withLoading(async () => {
      await invoke('remove_ink_stroke', {
        path: filePath, pageIndex: currentPage, index: inkIndex,
      });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Drawing removed');
    });
  };

  // Click an existing highlight (while in highlight mode) to remove it.
  const removeHighlight = (highlightIndex: number) => {
    void withLoading(async () => {
      await invoke('remove_highlight', {
        path: filePath, pageIndex: currentPage, index: highlightIndex,
      });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Highlight removed');
    });
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
    void withLoading(async () => {
      await invoke('remove_text_note', {
        path: filePath, pageIndex: currentPage, index: noteIndex,
      });
      markPdfEdited();
      await refreshAnnotations();
      showToast('Note removed');
    });
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
      savedIdxRef.current = histIdxRef.current;
      refreshUndoRedoState();
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
      savedIdxRef.current = histIdxRef.current;
      refreshUndoRedoState();
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
      savedIdxRef.current = histIdxRef.current;
      refreshUndoRedoState();
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

  const resolveUnsaved = async (choice: 'save' | 'discard' | 'cancel') => {
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
    setShowOpenModal(false);
    setShowBrowserModal(false);
    setShowDeleteModal(false);
    setShowSplitModal(false);
    setShowInsertModal(false);
    setShowMergeModal(false);
    setShowSearchModal(false);
    setActiveSearchRect(null);
    setShowImageInsertModal(false);
    setShowAddFormFieldModal(false);
    setShowSummaryModal(false);
    setShowPageTextModal(false);
    setShowPageEditsModal(false);
  }, [showUnsavedModal]);

  const refreshAfterWorkingChange = async () => {
    const working = filePath;
    const count = await invoke<number>('get_pdf_page_count', { path: working });
    setPageCount(count);
    const page = Math.max(0, Math.min(currentPage, count - 1));
    setCurrentPage(page);
    setViewMode('pdf');
    setMarkdownRevision(null);
    setPdfRevision((r) => r + 1);
    cancelDrawing();
    await renderPage(working, page);
    await loadThumbnails(working);
  };

  const undo = async () => {
    if (histIdxRef.current <= 0) return;
    await withLoading(async () => {
      histIdxRef.current -= 1;
      await invoke('restore_history_entry', {
        history: historyRef.current,
        index: histIdxRef.current,
        target: filePath,
      });
      await refreshAfterWorkingChange();
      refreshUndoRedoState();
    });
  };

  const redo = async () => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    await withLoading(async () => {
      histIdxRef.current += 1;
      await invoke('restore_history_entry', {
        history: historyRef.current,
        index: histIdxRef.current,
        target: filePath,
      });
      await refreshAfterWorkingChange();
      refreshUndoRedoState();
    });
  };

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
    || showSplitModal || showInsertModal || showMergeModal || showSearchModal || showNoteModal || showImageInsertModal
    || showAddFormFieldModal || showSummaryModal || showPageTextModal || showPageEditsModal;

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
    historyRef.current.forEach((entry) => void invoke('discard_history_entry', { entry }).catch(() => {}));
    historyRef.current = [];
    histIdxRef.current = 0;
    savedIdxRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);
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
    setAnnotations([]);
    setShowDeleteModal(false);
    setImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setThumbnails((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
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
    if (switchToMarkdown) setViewMode('markdown');
    showToast(result.written ? `Markdown saved to ${result.markdownPath}` : 'Markdown file is already up to date');
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
    await handleMarkdownView();
  };
  toggleMarkdownViewRef.current = toggleMarkdownView;

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

  const handleInsertPdf = async () => {
    if (!filePath || !insertFilePath) return;
    await withLoading(async () => {
      await invoke('insert_pdf', {
        path: filePath,
        insertPath: insertFilePath,
        atIndex: insertAtPage,
        insertStart: insertStartPage,
        insertEnd: insertEndPage,
      });
      markPdfEdited();
      showToast('PDF inserted successfully');
      setShowInsertModal(false);
      setInsertFilePath('');
      setInsertAtPage(0);
      setInsertStartPage(0);
      setInsertEndPage(0);
      await loadThumbnails(filePath);
      const count = await invoke<number>('get_pdf_page_count', { path: filePath });
      setPageCount(count);
    });
  };

  const handleMergePdf = async () => {
    if (!filePath || !mergeFilePath) return;
    await withLoading(async () => {
      const added = await invoke<number>('merge_pdf', {
        path: filePath,
        mergePath: mergeFilePath,
        mergeStart: mergeStartPage,
        mergeEnd: mergeEndPage,
      });
      markPdfEdited();
      showToast(`Merged ${added} page${added === 1 ? '' : 's'} from source PDF`);
      setShowMergeModal(false);
      setMergeFilePath('');
      setMergeStartPage(0);
      setMergeEndPage(0);
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
    if (!filePath) return;
    await withLoading(async () => {
      await invoke('set_pdf_metadata', {
        path: filePath,
        title: metadataTitle.trim() || null,
        author: metadataAuthor.trim() || null,
        subject: metadataSubject.trim() || null,
        keywords: metadataKeywords.trim() || null,
        creator: metadataCreator.trim() || null,
        producer: metadataProducer.trim() || null,
      });
      markPdfEdited();
      setShowMetadataModal(false);
      showToast('Document metadata updated');
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

  // Commit-on-Enter helper for the numeric fields (Tab / click-out commit via onBlur).
  const onFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (e.key === 'Enter') {
      commit();
      e.currentTarget.blur();
    }
  };

  return (
    <div className="app">
      <Toast notification={toast} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
        </div>
      )}

      {/* Sidebar */}
      <aside className="sidebar">
        <h3>Thumbnails</h3>
        {thumbnails.length > 0 ? (
          <div className="thumbnail-list">
            {thumbnails.map((src, idx) => (
              <img
                key={idx}
                src={src}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onClick={() => goToPage(idx)}
                className={`thumbnail ${currentPage === idx ? 'active' : ''} ${draggedIndex === idx ? 'dragging' : ''}`}
                alt={`Page ${idx + 1}`}
              />
            ))}
          </div>
        ) : (
          <p className="muted">No thumbnails loaded</p>
        )}
        {filePath && showBookmarksPanel && (
          <div className="bookmarks-panel">
            <div className="forms-panel-header">
              <h3>Bookmarks</h3>
              <button type="button" onClick={() => void loadPdfBookmarks(filePath)} className="btn" title="Reload bookmarks">
                Refresh
              </button>
            </div>
            {pdfBookmarks.length === 0 ? (
              <p className="muted">No bookmarks in this PDF.</p>
            ) : (
              <div className="bookmark-list">
                {pdfBookmarks.map((bookmark, index) => (
                  <button
                    key={`${bookmark.title}-${index}`}
                    type="button"
                    className={`bookmark-row ${bookmark.page_index === currentPage ? 'active' : ''}`}
                    style={{ paddingLeft: `${12 + bookmark.depth * 14}px` }}
                    disabled={bookmark.page_index === null}
                    onClick={() => {
                      if (bookmark.page_index !== null) goToPage(bookmark.page_index);
                    }}
                  >
                    <span className="bookmark-title">{bookmark.title}</span>
                    {bookmark.page_index !== null && (
                      <span className="muted bookmark-page">p.{bookmark.page_index + 1}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {filePath && showSignaturesPanel && (
          <div className="signatures-panel">
            <div className="forms-panel-header">
              <h3>Digital Signatures</h3>
              <button type="button" onClick={() => void loadPdfSignatures(filePath)} className="btn" title="Re-verify signatures">
                Refresh
              </button>
            </div>
            {pdfSignatures.length === 0 ? (
              <p className="muted">No digital signatures in this PDF.</p>
            ) : (
              <div className="signature-list">
                {pdfSignatures.map((sig) => {
                  const verified = signatureVerification?.signatures.find((entry) => entry.field_name === sig.field_name);
                  const status = verified?.status ?? 'indeterminate';
                  return (
                    <div key={sig.field_name} className={`signature-row signature-row--${status}`}>
                      <div className="signature-row-header">
                        <strong>{sig.field_name}</strong>
                        <span className={`signature-status signature-status--${status}`}>
                          {signatureStatusLabel(status)}
                        </span>
                      </div>
                      {sig.signer_name && <div className="muted">Signer: {sig.signer_name}</div>}
                      {sig.reason && <div className="muted">Reason: {sig.reason}</div>}
                      {sig.location && <div className="muted">Location: {sig.location}</div>}
                      {sig.signing_time && <div className="muted">Signed: {sig.signing_time}</div>}
                      {sig.signed_percent !== null && (
                        <div className="muted">Coverage: {sig.signed_percent.toFixed(1)}%</div>
                      )}
                      {verified && (
                        <div className="muted signature-summary">{verified.summary}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {signatureVerification && signatureVerification.signature_count > 0 && (
              <p className="muted signature-doc-summary">{signatureVerification.summary}</p>
            )}
          </div>
        )}
        {filePath && showFormsPanel && (
          <div className="forms-panel">
            <div className="forms-panel-header">
              <h3>Form Fields</h3>
              <button type="button" onClick={openAddFormFieldModal} className="btn" title="Add text field">
                + Field
              </button>
            </div>
            {formFields.length === 0 ? (
              <p className="muted">No fillable fields in this PDF.</p>
            ) : (
              <div className="form-field-list">
                {formFields.map((field) => (
                  <div key={field.name} className="form-field-row">
                    <div className="form-field-meta">
                      <strong>{field.name}</strong>
                      <span className="muted">{field.field_type}</span>
                    </div>
                    {field.field_type === 'checkbox' || field.field_type === 'radio' ? (
                      <label className="form-checkbox-row">
                        <input
                          type="checkbox"
                          checked={formDrafts[field.name] === 'true'}
                          onChange={(e) => setFormDrafts((prev) => ({
                            ...prev,
                            [field.name]: e.target.checked ? 'true' : 'false',
                          }))}
                        />
                        <span>Checked</span>
                      </label>
                    ) : field.field_type === 'choice' && field.options.length > 0 ? (
                      <select
                        className="form-field-input"
                        value={formDrafts[field.name] ?? ''}
                        onChange={(e) => setFormDrafts((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      >
                        {field.options.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="form-field-input"
                        value={formDrafts[field.name] ?? ''}
                        disabled={field.field_type === 'button' || field.field_type === 'signature'}
                        onChange={(e) => setFormDrafts((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      />
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={field.field_type === 'button' || field.field_type === 'signature'}
                      onClick={() => applyFormField(field.name)}
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="main">
        {/* Fixed header: toolbar + page/zoom controls stay put while the page scrolls */}
        <div className="header">
          <div className="toolbar">
            <button onClick={openPdf} className="btn btn-active" title="Open PDF (Ctrl+O)" data-testid="open-pdf">Open PDF</button>
            {filePath && (
              <>
                <button onClick={handleSave} className="btn" disabled={!isDirty} title="Save (Ctrl+S)" data-testid="save-pdf">{isDirty ? 'Save •' : 'Save'}</button>
                <button onClick={openSaveAs} className="btn" title="Save As… (Ctrl+Shift+S)">Save As…</button>
                <button onClick={undo} className="btn" disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
                <button onClick={redo} className="btn" disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
                <button onClick={handleRotatePage} className="btn" title="Rotate 90° (Ctrl+R)" data-testid="rotate-page">Rotate</button>
                <button onClick={handleDuplicatePage} className="btn" title="Duplicate current page (Ctrl+Shift+D)" data-testid="duplicate-page">Duplicate</button>
                <button onClick={openDeleteModal} className="btn" disabled={pageCount !== null && pageCount <= 1} title="Delete page (Delete)">Delete</button>
                <button onClick={openInsertModal} className="btn" title="Insert PDF (Ctrl+Shift+I)">Insert</button>
                <button onClick={openMergeModal} className="btn" title="Merge PDF — append pages (Ctrl+Shift+G)">Merge</button>
                <button onClick={openSplitModal} className="btn" title="Split PDF (Ctrl+Shift+K)">Split</button>
                <button onClick={openSearchModal} className="btn" title="Find text (Ctrl+F)" data-testid="search-pdf">Find</button>
                <div className="view-toggle" role="group" aria-label="Document view">
                  <button
                    type="button"
                    onClick={() => setViewMode('pdf')}
                    className={viewMode === 'pdf' ? 'active' : ''}
                    aria-pressed={viewMode === 'pdf'}
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleMarkdownView()}
                    className={viewMode === 'markdown' ? 'active' : ''}
                    aria-pressed={viewMode === 'markdown'}
                    title="Toggle Markdown view (Ctrl+Shift+M)"
                  >
                    Markdown
                  </button>
                </div>
                <button onClick={handleOptimizePdf} className="btn" title="Optimize PDF (Ctrl+Shift+O)">Optimize</button>
                <button
                  onClick={() => void openMetadataModal()}
                  className="btn"
                  title="Edit document metadata (title, author, subject…)"
                  data-testid="metadata-pdf"
                >
                  Metadata
                </button>
                <button
                  onClick={() => void handleSummarizePdf()}
                  className="btn"
                  title="Summarize & extract (Ctrl+Shift+E)"
                  data-testid="summarize-pdf"
                >
                  Summarize
                </button>
                <button onClick={openProtectModal} className="btn" title="Export password-protected PDF">Protect</button>
                <button
                  onClick={openSignModal}
                  className="btn"
                  title="Digitally sign with PKCS#12 certificate (Ctrl+Shift+U)"
                  data-testid="sign-pdf"
                >
                  Sign
                </button>
                <button
                  onClick={toggleSignaturesPanel}
                  className={`btn ${showSignaturesPanel ? 'btn-active' : ''}`}
                  title="View and verify digital signatures"
                  data-testid="signatures-panel"
                >
                  {showSignaturesPanel ? 'Signatures: ON' : 'Signatures'}
                </button>
                <button
                  onClick={() => setShowBookmarksPanel((prev) => !prev)}
                  className={`btn ${showBookmarksPanel ? 'btn-active' : ''}`}
                  title="PDF outline bookmarks"
                  data-testid="bookmarks-panel"
                >
                  {showBookmarksPanel ? 'Bookmarks: ON' : 'Bookmarks'}
                </button>
                <button
                  onClick={toggleRedactMode}
                  className={`btn ${redactMode ? 'btn-active' : ''}`}
                  title="Toggle redaction mode (X)"
                >
                  {redactMode ? 'Redact: ON' : 'Redact'}
                </button>
                <button onClick={handlePrint} className="btn" title="Print (Ctrl+P)">Print</button>
                <button
                  onClick={toggleHighlightMode}
                  className={`btn ${highlightMode ? 'btn-active' : ''}`}
                  title="Toggle highlight mode (H)"
                >
                  {highlightMode ? 'Highlight: ON' : 'Highlight'}
                </button>
                <button
                  onClick={toggleNoteMode}
                  className={`btn ${noteMode ? 'btn-active' : ''}`}
                  title="Toggle sticky note mode (N)"
                >
                  {noteMode ? 'Note: ON' : 'Note'}
                </button>
                <button
                  onClick={toggleDrawMode}
                  className={`btn ${drawMode ? 'btn-active' : ''}`}
                  title="Toggle freehand draw mode (D)"
                >
                  {drawMode ? 'Draw: ON' : 'Draw'}
                </button>
                <button
                  onClick={toggleShapeMode}
                  className={`btn ${shapeMode ? 'btn-active' : ''}`}
                  title="Toggle shape mode — rectangle, ellipse, line (S)"
                >
                  {shapeMode ? 'Shape: ON' : 'Shape'}
                </button>
                <button
                  onClick={toggleStampMode}
                  className={`btn ${stampMode ? 'btn-active' : ''}`}
                  title="Toggle stamp mode — text and image stamps (T)"
                >
                  {stampMode ? 'Stamp: ON' : 'Stamp'}
                </button>
                <button
                  onClick={toggleImageInsertMode}
                  className={`btn ${imageInsertMode ? 'btn-active' : ''}`}
                  title="Insert image on page — PNG/JPEG (I)"
                >
                  {imageInsertMode ? 'Image: ON' : 'Insert Image'}
                </button>
                <button
                  onClick={toggleTextEditMode}
                  className={`btn ${textEditMode ? 'btn-active' : ''}`}
                  title="Place editable text in page content (E)"
                  data-testid="text-edit-mode"
                >
                  {textEditMode ? 'Text: ON' : 'Page Text'}
                </button>
                <button
                  onClick={toggleVectorEditMode}
                  className={`btn ${vectorEditMode ? 'btn-active' : ''}`}
                  title="Draw vector rectangles in page content (G)"
                  data-testid="vector-edit-mode"
                >
                  {vectorEditMode ? 'Vector: ON' : 'Vector'}
                </button>
                <button
                  onClick={() => setShowPageEditsModal(true)}
                  className="btn"
                  title="Manage page text and vector edits on this page"
                >
                  Edits
                </button>
                <button
                  onClick={toggleFormsPanel}
                  className={`btn ${showFormsPanel ? 'btn-active' : ''}`}
                  title="Form fields — fill and create text fields (F)"
                >
                  {showFormsPanel ? 'Forms: ON' : 'Forms'}
                </button>
                {imageInsertMode && imageSourcePath && (
                  <button
                    type="button"
                    onClick={openImageInsertModal}
                    className="btn"
                    title="Change source image"
                  >
                    {fileNameFromPath(imageSourcePath)}
                  </button>
                )}
                {stampMode && (
                  <div className="stamp-toolbar" role="group" aria-label="Stamp options">
                    <div className="shape-kind-toggle" role="group" aria-label="Stamp kind">
                      <button
                        type="button"
                        className={stampKind === 'text' ? 'active' : ''}
                        onClick={() => setStampKind('text')}
                      >
                        Text
                      </button>
                      <button
                        type="button"
                        className={stampKind === 'image' ? 'active' : ''}
                        onClick={() => setStampKind('image')}
                      >
                        Image
                      </button>
                    </div>
                    <select
                      className="stamp-preset-select"
                      value={stampPreset}
                      onChange={(e) => setStampPreset(e.target.value)}
                      aria-label="Stamp preset"
                    >
                      {STAMP_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {shapeMode && (
                  <div className="shape-kind-toggle" role="group" aria-label="Shape kind">
                    <button
                      type="button"
                      className={shapeKind === 'square' ? 'active' : ''}
                      onClick={() => setShapeKind('square')}
                    >
                      Rect
                    </button>
                    <button
                      type="button"
                      className={shapeKind === 'circle' ? 'active' : ''}
                      onClick={() => setShapeKind('circle')}
                    >
                      Ellipse
                    </button>
                    <button
                      type="button"
                      className={shapeKind === 'line' ? 'active' : ''}
                      onClick={() => setShapeKind('line')}
                    >
                      Line
                    </button>
                  </div>
                )}
                <button onClick={() => guardUnsaved(closePdf)} className="btn" title="Close (Ctrl+W)">Close</button>
              </>
            )}
          </div>

          {pageCount !== null && viewMode === 'pdf' && (
            <div className="page-controls">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} className="btn">Prev</button>
              <span className="field-group">
                <input
                  className="num-input"
                  type="text"
                  inputMode="numeric"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => onFieldKeyDown(e, commitPage)}
                  onBlur={commitPage}
                  aria-label="Current page"
                />
                <span className="muted" data-testid="page-count">/ {pageCount}</span>
              </span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount - 1} className="btn">Next</button>

              <span className="zoom-divider" />

              <button onClick={zoomOut} disabled={zoom <= MIN_ZOOM} className="btn">−</button>
              <span className="field-group">
                <input
                  className="num-input"
                  type="text"
                  inputMode="numeric"
                  value={zoomInput}
                  onChange={(e) => setZoomInput(e.target.value)}
                  onKeyDown={(e) => onFieldKeyDown(e, commitZoom)}
                  onBlur={commitZoom}
                  aria-label="Zoom percent"
                />
                <span className="muted">%</span>
              </span>
              <button onClick={zoomIn} disabled={zoom >= MAX_ZOOM} className="btn">+</button>
              <button onClick={resetZoom} className="btn btn-secondary">Reset</button>
            </div>
          )}
        </div>

        {/* Scrollable page area */}
        <div className={`page-scroll ${viewMode === 'markdown' ? 'markdown-scroll' : ''}`} ref={scrollRef} onWheel={handleWheel}>
          {viewMode === 'markdown' ? (
            <div className="markdown-viewer">
              <div className="markdown-header">
                <span>Markdown</span>
                {markdownPath && <span className="markdown-path">{markdownPath}</span>}
                <button type="button" onClick={openMarkdownSaveAs} className="btn btn-secondary">Save As…</button>
              </div>
              <pre className="markdown-preview">{markdownText}</pre>
            </div>
          ) : (
            <div
              className={`page-container ${highlightMode ? 'highlight-cursor' : ''} ${noteMode ? 'note-cursor' : ''} ${drawMode ? 'draw-cursor' : ''} ${shapeMode ? 'shape-cursor' : ''} ${stampMode ? 'stamp-cursor' : ''} ${redactMode ? 'redact-cursor' : ''} ${imageInsertMode ? 'image-insert-cursor' : ''} ${textEditMode ? 'text-edit-cursor' : ''} ${vectorEditMode ? 'vector-edit-cursor' : ''} ${formAddMode ? 'form-add-cursor' : ''}`}
              onClick={handlePageClick}
              onMouseDown={handleDrawMouseDown}
              onMouseMove={handlePageMouseMove}
              onMouseUp={handleDrawMouseUp}
              onMouseLeave={handleDrawMouseUp}
            >
              {imageSrc ? (
                <div className="page-scale" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img ref={imgRef} src={imageSrc} alt="PDF Page" className="page-image" draggable={false} onLoad={handleImageLoad} />
                    {/* Active search match highlight (not persisted) */}
                    {activeSearchRect && (
                      <div
                        className="search-highlight-overlay"
                        style={{
                          left: activeSearchRect[0],
                          top: activeSearchRect[1],
                          width: activeSearchRect[2] - activeSearchRect[0],
                          height: activeSearchRect[3] - activeSearchRect[1],
                        }}
                      />
                    )}
                    {/* Existing highlights */}
                    {annotations.filter((a) => a.subtype === 'Highlight').map((a, i) => (
                      <div
                        key={i}
                        className="highlight-overlay"
                        title={highlightMode ? 'Click to remove' : undefined}
                        onClick={highlightMode ? (e) => { e.stopPropagation(); removeHighlight(i); } : undefined}
                        style={{
                          left: a.rect[0],
                          top: a.rect[1],
                          width: a.rect[2] - a.rect[0],
                          height: a.rect[3] - a.rect[1],
                          backgroundColor: a.color
                            ? `rgba(${a.color[0] * 255},${a.color[1] * 255},${a.color[2] * 255},0.3)`
                            : 'rgba(255,255,0,0.3)',
                          pointerEvents: highlightMode ? 'auto' : 'none',
                          cursor: highlightMode ? 'pointer' : 'default',
                        }}
                      />
                    ))}
                    {/* Redaction boxes */}
                    {annotations.filter((a) => a.is_redaction).map((a, i) => (
                      <div
                        key={`redact-${i}`}
                        className="redaction-overlay"
                        title={redactMode ? 'Click to remove' : undefined}
                        onClick={redactMode ? (e) => { e.stopPropagation(); removeRedaction(i); } : undefined}
                        style={{
                          left: a.rect[0],
                          top: a.rect[1],
                          width: a.rect[2] - a.rect[0],
                          height: a.rect[3] - a.rect[1],
                          pointerEvents: redactMode ? 'auto' : 'none',
                          cursor: redactMode ? 'pointer' : 'default',
                        }}
                      />
                    ))}
                    {/* Text stamps */}
                    {annotations.filter((a) => a.stamp_kind === 'text').map((a, i) => {
                      const meta = stampPresetMeta(a.stamp_preset);
                      return (
                        <div
                          key={`text-stamp-${i}`}
                          className="text-stamp-overlay"
                          title={stampMode ? 'Click to remove' : undefined}
                          onClick={stampMode ? (e) => { e.stopPropagation(); removeStamp('text', i); } : undefined}
                          style={{
                            left: a.rect[0],
                            top: a.rect[1],
                            width: a.rect[2] - a.rect[0],
                            height: a.rect[3] - a.rect[1],
                            borderColor: meta?.color ?? '#333',
                            color: meta?.color ?? '#333',
                            pointerEvents: stampMode ? 'auto' : 'none',
                            cursor: stampMode ? 'pointer' : 'default',
                          }}
                        >
                          {a.contents ?? meta?.label}
                        </div>
                      );
                    })}
                    {/* Image stamps */}
                    {annotations.filter((a) => a.stamp_kind === 'image').map((a, i) => {
                      const meta = stampPresetMeta(a.stamp_preset);
                      return (
                        <div
                          key={`image-stamp-${i}`}
                          className="image-stamp-overlay"
                          title={stampMode ? 'Click to remove' : undefined}
                          onClick={stampMode ? (e) => { e.stopPropagation(); removeStamp('image', i); } : undefined}
                          style={{
                            left: a.rect[0],
                            top: a.rect[1],
                            width: a.rect[2] - a.rect[0],
                            height: a.rect[3] - a.rect[1],
                            backgroundColor: meta?.color ?? '#666',
                            pointerEvents: stampMode ? 'auto' : 'none',
                            cursor: stampMode ? 'pointer' : 'default',
                          }}
                        >
                          {meta?.label}
                        </div>
                      );
                    })}
                    {/* Shape outlines */}
                    {annotations.filter((a) => a.subtype === 'Square' && !a.is_redaction).map((a, i) => (
                      <div
                        key={`square-${i}`}
                        className="shape-overlay shape-square"
                        title={shapeMode ? 'Click to remove' : undefined}
                        onClick={shapeMode ? (e) => { e.stopPropagation(); removeShape('Square', i); } : undefined}
                        style={{
                          left: a.rect[0],
                          top: a.rect[1],
                          width: a.rect[2] - a.rect[0],
                          height: a.rect[3] - a.rect[1],
                          borderColor: shapeStrokeColor(a.color),
                          pointerEvents: shapeMode ? 'auto' : 'none',
                          cursor: shapeMode ? 'pointer' : 'default',
                        }}
                      />
                    ))}
                    {annotations.filter((a) => a.subtype === 'Circle').map((a, i) => (
                      <div
                        key={`circle-${i}`}
                        className="shape-overlay shape-circle"
                        title={shapeMode ? 'Click to remove' : undefined}
                        onClick={shapeMode ? (e) => { e.stopPropagation(); removeShape('Circle', i); } : undefined}
                        style={{
                          left: a.rect[0],
                          top: a.rect[1],
                          width: a.rect[2] - a.rect[0],
                          height: a.rect[3] - a.rect[1],
                          borderColor: shapeStrokeColor(a.color),
                          pointerEvents: shapeMode ? 'auto' : 'none',
                          cursor: shapeMode ? 'pointer' : 'default',
                        }}
                      />
                    ))}
                    {/* Freehand ink strokes and line shapes */}
                    <svg
                      className="ink-overlay"
                      viewBox={`0 0 ${BASE_W} ${BASE_H}`}
                      aria-hidden={!drawMode && !shapeMode}
                    >
                      {annotations.filter((a) => a.subtype === 'Line' && a.line_endpoints).map((a, i) => {
                        const [x1, y1, x2, y2] = a.line_endpoints!;
                        const stroke = shapeStrokeColor(a.color);
                        return (
                          <g key={`line-${i}`}>
                            {shapeMode && (
                              <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="transparent"
                                strokeWidth={12}
                                strokeLinecap="round"
                                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); removeShape('Line', i); }}
                              />
                            )}
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={stroke}
                              strokeWidth={2}
                              strokeLinecap="round"
                              style={{ pointerEvents: 'none' }}
                            />
                          </g>
                        );
                      })}
                      {annotations.filter((a) => a.subtype === 'Ink').map((a, i) => {
                        const points = inkPointsToPolyline(a.ink_points);
                        const stroke = a.color
                          ? `rgb(${a.color[0] * 255},${a.color[1] * 255},${a.color[2] * 255})`
                          : 'rgb(0,0,255)';
                        return (
                          <g key={`ink-${i}`}>
                            {drawMode && (
                              <polyline
                                points={points}
                                fill="none"
                                stroke="transparent"
                                strokeWidth={12}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); removeInkStroke(i); }}
                              />
                            )}
                            <polyline
                              points={points}
                              fill="none"
                              stroke={stroke}
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ pointerEvents: 'none' }}
                            />
                          </g>
                        );
                      })}
                      {inkDraft.length >= 2 && (
                        <polyline
                          points={inkPointsToPolyline(inkDraft)}
                          fill="none"
                          stroke="rgb(0,0,255)"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ pointerEvents: 'none', opacity: 0.75 }}
                        />
                      )}
                      {shapeMode && drawing && highlightStart && shapeKind === 'line' && shapeLineEnd && (
                        <line
                          x1={highlightStart.x}
                          y1={highlightStart.y}
                          x2={shapeLineEnd.x}
                          y2={shapeLineEnd.y}
                          stroke="rgb(255,0,0)"
                          strokeWidth={2}
                          strokeLinecap="round"
                          style={{ pointerEvents: 'none', opacity: 0.75 }}
                        />
                      )}
                    </svg>
                    {/* Sticky text notes */}
                    {annotations.filter((a) => a.subtype === 'Text').map((a, i) => (
                      <div
                        key={`note-${i}`}
                        className="text-note-overlay"
                        title={noteMode ? 'Click to remove' : (a.contents ?? undefined)}
                        onClick={noteMode ? (e) => { e.stopPropagation(); removeTextNote(i); } : undefined}
                        style={{
                          left: a.rect[0],
                          top: a.rect[1],
                          width: a.rect[2] - a.rect[0],
                          height: a.rect[3] - a.rect[1],
                          pointerEvents: noteMode ? 'auto' : 'none',
                          cursor: noteMode ? 'pointer' : 'default',
                        }}
                      >
                        {a.contents}
                      </div>
                    ))}
                    {pageTextEdits.map((edit) => (
                      <div
                        key={`page-text-${edit.index}`}
                        className="page-text-edit-overlay"
                        style={{ left: edit.x, top: edit.y }}
                        title={edit.text}
                      >
                        {edit.text}
                      </div>
                    ))}
                    {pageVectorEdits.map((edit) => (
                      <div
                        key={`page-vector-${edit.index}`}
                        className="page-vector-edit-overlay"
                        style={{
                          left: edit.x,
                          top: edit.y,
                          width: edit.width,
                          height: edit.height,
                        }}
                      />
                    ))}
                    {/* Current highlight drag */}
                    {highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && highlightMode && (
                      <div
                        className="highlight-draft"
                        style={{
                          left: highlightRect.x,
                          top: highlightRect.y,
                          width: highlightRect.w,
                          height: highlightRect.h,
                        }}
                      />
                    )}
                    {/* Current shape drag */}
                    {shapeMode && highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && shapeKind !== 'line' && (
                      <div
                        className={`shape-draft ${shapeKind === 'circle' ? 'shape-circle' : 'shape-square'}`}
                        style={{
                          left: highlightRect.x,
                          top: highlightRect.y,
                          width: highlightRect.w,
                          height: highlightRect.h,
                        }}
                      />
                    )}
                    {redactMode && highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && (
                      <div
                        className="redaction-draft"
                        style={{
                          left: highlightRect.x,
                          top: highlightRect.y,
                          width: highlightRect.w,
                          height: highlightRect.h,
                        }}
                      />
                    )}
                    {imageInsertMode && highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && (
                      <div
                        className="image-insert-draft"
                        style={{
                          left: highlightRect.x,
                          top: highlightRect.y,
                          width: highlightRect.w,
                          height: highlightRect.h,
                        }}
                      />
                    )}
                    {vectorEditMode && highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && (
                      <div
                        className="page-vector-edit-overlay page-vector-draft"
                        style={{
                          left: highlightRect.x,
                          top: highlightRect.y,
                          width: highlightRect.w,
                          height: highlightRect.h,
                        }}
                      />
                    )}
                    {formAddMode && highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && (
                      <div
                        className="form-field-draft"
                        style={{
                          left: highlightRect.x,
                          top: highlightRect.y,
                          width: highlightRect.w,
                          height: highlightRect.h,
                        }}
                      />
                    )}
                    {showFormsPanel && formFields
                      .filter((field) => field.page_index === currentPage && field.rect)
                      .map((field) => {
                        const rect = field.rect!;
                        return (
                          <div
                            key={field.name}
                            className="form-field-overlay"
                            style={{
                              left: rect[0],
                              top: rect[1],
                              width: Math.max(0, rect[2] - rect[0]),
                              height: Math.max(0, rect[3] - rect[1]),
                            }}
                            title={field.name}
                          />
                        );
                      })}
                  </div>
                </div>
              ) : (
                <p className="muted">No page rendered — click “Open PDF” to begin.</p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Open Modal */}
      {showOpenModal && (
        <Modal onClose={() => setShowOpenModal(false)}>
          <h3>Open PDF</h3>
          <label>PDF path:</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={openFilePath}
              onChange={(e) => setOpenFilePath(e.target.value)}
              onKeyDown={(e) => onFieldKeyDown(e, handleOpenPdfPath)}
              className="modal-input"
              placeholder="/path/to/document.pdf"
              data-testid="open-pdf-path"
              autoFocus
            />
            {nativeDialogs && (
              <button onClick={() => void chooseOpenPdfNative()} className="btn" data-testid="native-open-pdf">Choose file…</button>
            )}
            <button onClick={() => openPdfBrowser('open')} className="btn">Browse…</button>
          </div>
          {recentPdfs.length > 0 && (
            <div className="recent-list" aria-label="Recently opened PDFs">
              <h4>Recently Opened</h4>
              {recentPdfs.map((path) => (
                <button key={path} className="recent-row" onClick={() => handleOpenRecentPdf(path)}>
                  <span className="recent-name">{fileNameFromPath(path)}</span>
                  <span className="recent-path">{path}</span>
                </button>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowOpenModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleOpenPdfPath} className="btn" disabled={!openFilePath.trim()} data-testid="open-pdf-submit">Open</button>
          </div>
        </Modal>
      )}

      {showNoteModal && (
        <Modal onClose={exitNoteMode}>
          <h3>Add Sticky Note</h3>
          <label>Note text:</label>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            className="modal-input note-textarea"
            rows={4}
            autoFocus
          />
          <div className="modal-actions">
            <button onClick={exitNoteMode} className="btn btn-secondary">Cancel</button>
            <button onClick={submitTextNote} className="btn" disabled={!noteDraft.trim()}>Add note</button>
          </div>
        </Modal>
      )}

      {/* Delete Modal */}
      {showDeleteModal && pageCount !== null && (
        <Modal onClose={() => setShowDeleteModal(false)}>
          <h3>Delete Page</h3>
          <p className="modal-help">
            Choose the page to remove. This edits the open PDF file on disk.
          </p>
          <label>Page to delete:</label>
          <input
            type="number"
            value={deletePageInput}
            onChange={(e) => setDeletePageInput(e.target.value)}
            onKeyDown={(e) => onFieldKeyDown(e, handleDeletePage)}
            className="modal-input"
            min="1"
            max={pageCount}
            autoFocus
          />
          <p className="muted">Current page: {currentPage + 1} / {pageCount}</p>
          <div className="modal-actions">
            <button onClick={() => setShowDeleteModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleDeletePage} className="btn btn-danger">Delete page</button>
          </div>
        </Modal>
      )}

      {/* Split Modal */}
      {showSplitModal && (
        <Modal onClose={() => setShowSplitModal(false)}>
          <h3>Split PDF</h3>
          <p>Enter page ranges (e.g., "1-3, 4-5, 6-10"):</p>
          <input
            type="text"
            value={splitRanges}
            onChange={(e) => setSplitRanges(e.target.value)}
            className="modal-input"
            placeholder="1-3, 4-6"
          />
          <p className="muted">Total pages: {pageCount}</p>
          <div className="modal-actions">
            <button onClick={() => setShowSplitModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSplitPdf} className="btn">Split</button>
          </div>
        </Modal>
      )}

      {showAddFormFieldModal && (
        <Modal onClose={() => setShowAddFormFieldModal(false)}>
          <h3>Add Form Field</h3>
          <p className="modal-help">Choose a field type, then place it on the current page.</p>
          <label>Field type:</label>
          <select
            className="modal-input"
            value={newFormFieldKind}
            onChange={(e) => setNewFormFieldKind(e.target.value as FormFieldKind)}
          >
            <option value="text">Text</option>
            <option value="checkbox">Checkbox</option>
            <option value="choice">Choice list</option>
            <option value="radio">Radio button</option>
          </select>
          {newFormFieldKind === 'radio' ? (
            <>
              <label>Group name:</label>
              <input
                type="text"
                value={newFormRadioGroup}
                onChange={(e) => setNewFormRadioGroup(e.target.value)}
                className="modal-input"
                placeholder="Color"
              />
              <label>Option name:</label>
              <input
                type="text"
                value={newFormRadioOption}
                onChange={(e) => setNewFormRadioOption(e.target.value)}
                className="modal-input"
                placeholder="Red"
              />
            </>
          ) : (
            <>
              <label>Field name:</label>
              <input
                type="text"
                value={newFormFieldName}
                onChange={(e) => setNewFormFieldName(e.target.value)}
                className="modal-input"
                placeholder="Email"
              />
              {newFormFieldKind === 'choice' && (
                <>
                  <label>Options (comma-separated):</label>
                  <input
                    type="text"
                    value={newFormFieldOptions}
                    onChange={(e) => setNewFormFieldOptions(e.target.value)}
                    className="modal-input"
                    placeholder="US, CA, MX"
                  />
                </>
              )}
              {newFormFieldKind === 'checkbox' && (
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={newFormCheckboxChecked}
                    onChange={(e) => setNewFormCheckboxChecked(e.target.checked)}
                  />
                  <span>Checked by default</span>
                </label>
              )}
            </>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowAddFormFieldModal(false)} className="btn btn-secondary">Cancel</button>
            <button
              onClick={confirmAddFormField}
              className="btn"
              disabled={
                newFormFieldKind === 'radio'
                  ? !newFormRadioGroup.trim() || !newFormRadioOption.trim()
                  : !newFormFieldName.trim()
              }
            >
              Place on page
            </button>
          </div>
        </Modal>
      )}

      {showImageInsertModal && (
        <Modal onClose={() => setShowImageInsertModal(false)}>
          <h3>Insert Image</h3>
          <p className="modal-help">Choose a PNG or JPEG file, then click twice on the page to size and place it.</p>
          <label>Image path:</label>
          <input
            type="text"
            value={imageSourceDraft}
            onChange={(e) => setImageSourceDraft(e.target.value)}
            className="modal-input"
            placeholder="/path/to/image.png"
          />
          <div className="modal-actions">
            <button onClick={() => setShowImageInsertModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void confirmImageSource()} className="btn" disabled={!imageSourceDraft.trim()}>Place on page</button>
          </div>
        </Modal>
      )}

      {/* Search Modal */}
      {showSearchModal && (
        <Modal onClose={closeSearchModal}>
          <h3>Find in PDF</h3>
          <label>Search for:</label>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="modal-input"
            placeholder="Text to find"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) stepSearchMatch(-1);
                else if (searchResults.length > 0) stepSearchMatch(1);
                else void runPdfSearch();
              }
            }}
          />
          <div className="search-options">
            <label className="form-checkbox-row">
              <input
                type="checkbox"
                checked={searchMatchCase}
                onChange={(e) => setSearchMatchCase(e.target.checked)}
              />
              <span>Match case</span>
            </label>
            <label className="form-checkbox-row">
              <input
                type="checkbox"
                checked={searchWholeWord}
                onChange={(e) => setSearchWholeWord(e.target.checked)}
              />
              <span>Whole words</span>
            </label>
          </div>
          {searchResults.length > 0 && (
            <p className="modal-help">
              Match {searchResultIndex + 1} of {searchResults.length} (page {searchResults[searchResultIndex].page_index + 1})
            </p>
          )}
          <div className="modal-actions">
            <button onClick={closeSearchModal} className="btn btn-secondary">Close</button>
            <button
              type="button"
              onClick={() => stepSearchMatch(-1)}
              className="btn"
              disabled={searchResults.length === 0}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => stepSearchMatch(1)}
              className="btn"
              disabled={searchResults.length === 0}
            >
              Next
            </button>
            <button onClick={() => void runPdfSearch()} className="btn" disabled={!searchQuery.trim()}>Find</button>
          </div>
        </Modal>
      )}

      {/* Merge Modal */}
      {showMergeModal && (
        <Modal onClose={() => { setShowMergeModal(false); setMergeFilePath(''); }}>
          <h3>Merge PDF</h3>
          <p className="modal-help">Append pages from another PDF to the end of this document.</p>
          <div className="insert-grid">
            <div className="insert-source">
              <label>Source PDF to merge:</label>
              <div className="modal-path-row">
                <input
                  type="text"
                  value={mergeFilePath}
                  onChange={(e) => setMergeFilePath(e.target.value)}
                  className="modal-input"
                  placeholder="/path/to/source.pdf"
                />
                {nativeDialogs && (
                  <button onClick={() => void chooseMergePdfNative()} className="btn">Choose file…</button>
                )}
                <button onClick={() => openPdfBrowser('merge')} className="btn">Browse…</button>
              </div>
            </div>
            <label>
              From page {mergeSourcePageCount ? `(1-${mergeSourcePageCount})` : ''} of source:
              <input
                type="number"
                value={mergeStartPage + 1}
                onChange={(e) => setMergeStartPage(Math.max(0, parseInt(e.target.value, 10) - 1))}
                min="1"
                max={mergeSourcePageCount ?? undefined}
                disabled={!mergeSourcePageCount}
                className="modal-input"
              />
            </label>
            <label>
              To page {mergeSourcePageCount ? `(1-${mergeSourcePageCount})` : ''} of source:
              <input
                type="number"
                value={mergeEndPage + 1}
                onChange={(e) => setMergeEndPage(Math.max(0, parseInt(e.target.value, 10) - 1))}
                min="1"
                max={mergeSourcePageCount ?? undefined}
                disabled={!mergeSourcePageCount}
                className="modal-input"
              />
            </label>
          </div>
          {mergeSourcePageCount ? (
            <p className="modal-help">
              Appends page{mergeStartPage === mergeEndPage ? '' : 's'} {mergeStartPage + 1}
              {mergeStartPage === mergeEndPage ? '' : `–${mergeEndPage + 1}`} of the source ({mergeSourcePageCount} pages) after page {pageCount ?? 0} of this document.
            </p>
          ) : null}
          <div className="modal-actions">
            <button onClick={() => { setShowMergeModal(false); setMergeFilePath(''); }} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleMergePdf()} className="btn" disabled={!mergeFilePath}>Merge</button>
          </div>
        </Modal>
      )}

      {/* Insert Modal */}
      {showInsertModal && (
        <Modal onClose={() => { setShowInsertModal(false); setInsertFilePath(''); }}>
          <h3>Insert PDF</h3>
          <div className="insert-grid">
            <div className="insert-source">
              <label>Source PDF to insert:</label>
              <div className="modal-path-row">
                <input
                  type="text"
                  value={insertFilePath}
                  onChange={(e) => setInsertFilePath(e.target.value)}
                  className="modal-input"
                  placeholder="/path/to/source.pdf"
                />
                {nativeDialogs && (
                  <button onClick={() => void chooseInsertPdfNative()} className="btn">Choose file…</button>
                )}
                <button onClick={() => openPdfBrowser('insert')} className="btn">Browse…</button>
              </div>
            </div>
            <label>
              Insert at page (1-{(pageCount ?? 0) + 1}) of this document:
              <input type="number" value={insertAtPage + 1} onChange={(e) => setInsertAtPage(Math.max(0, parseInt(e.target.value) - 1))} min="1" max={(pageCount ?? 0) + 1} className="modal-input" />
            </label>
            <label>
              From page {insertSourcePageCount ? `(1-${insertSourcePageCount})` : ''} of source:
              <input type="number" value={insertStartPage + 1} onChange={(e) => setInsertStartPage(Math.max(0, parseInt(e.target.value) - 1))} min="1" max={insertSourcePageCount ?? undefined} disabled={!insertSourcePageCount} className="modal-input" />
            </label>
            <label>
              To page {insertSourcePageCount ? `(1-${insertSourcePageCount})` : ''} of source:
              <input type="number" value={insertEndPage + 1} onChange={(e) => setInsertEndPage(Math.max(0, parseInt(e.target.value) - 1))} min="1" max={insertSourcePageCount ?? undefined} disabled={!insertSourcePageCount} className="modal-input" />
            </label>
          </div>
          {insertSourcePageCount ? (
            <p className="modal-help">
              Inserts page{insertStartPage === insertEndPage ? '' : 's'} {insertStartPage + 1}
              {insertStartPage === insertEndPage ? '' : `–${insertEndPage + 1}`} of the source ({insertSourcePageCount} pages) at position {insertAtPage + 1} of this document.
            </p>
          ) : null}
          <div className="modal-actions">
            <button onClick={() => { setShowInsertModal(false); setInsertFilePath(''); }} className="btn btn-secondary">Cancel</button>
            <button onClick={handleInsertPdf} className="btn" disabled={!insertFilePath}>Insert</button>
          </div>
        </Modal>
      )}

      {showPageTextModal && (
        <Modal onClose={() => { setShowPageTextModal(false); setEditingTextIndex(null); setPendingTextPos(null); }}>
          <h3>{editingTextIndex !== null ? 'Edit Page Text' : 'Add Page Text'}</h3>
          <label>Text:</label>
          <input
            type="text"
            value={pageTextDraft}
            onChange={(e) => setPageTextDraft(e.target.value)}
            className="modal-input"
            autoFocus
          />
          <label>Font size (8–72):</label>
          <input
            type="number"
            min="8"
            max="72"
            value={pageTextFontSize}
            onChange={(e) => setPageTextFontSize(e.target.value)}
            className="modal-input"
          />
          <div className="modal-actions">
            <button onClick={() => { setShowPageTextModal(false); setEditingTextIndex(null); setPendingTextPos(null); }} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void submitPageText()} className="btn" disabled={!pageTextDraft.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {showPageEditsModal && (
        <Modal onClose={() => setShowPageEditsModal(false)}>
          <h3>Page Edits — page {currentPage + 1}</h3>
          <p className="modal-help">Text and vector shapes embedded in the PDF content stream for this page.</p>
          <h4>Text blocks</h4>
          {pageTextEdits.length === 0 ? (
            <p className="muted">No page text on this page.</p>
          ) : (
            <ul className="summary-list">
              {pageTextEdits.map((edit) => (
                <li key={`manage-text-${edit.index}`} className="page-edit-row">
                  <span>{edit.text}</span>
                  <span className="page-edit-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => startEditPageText(edit)}>Edit</button>
                    <button type="button" className="btn btn-secondary" onClick={() => void removePageTextEdit(edit.index)}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h4>Vector shapes</h4>
          {pageVectorEdits.length === 0 ? (
            <p className="muted">No vector shapes on this page.</p>
          ) : (
            <ul className="summary-list">
              {pageVectorEdits.map((edit) => (
                <li key={`manage-vector-${edit.index}`} className="page-edit-row">
                  <span>{edit.kind} {Math.round(edit.width)}×{Math.round(edit.height)}</span>
                  <button type="button" className="btn btn-secondary" onClick={() => void removePageVectorEdit(edit.index)}>Delete</button>
                </li>
              ))}
            </ul>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowPageEditsModal(false)} className="btn">Close</button>
          </div>
        </Modal>
      )}

      {showSummaryModal && pdfSummary && (
        <Modal onClose={() => setShowSummaryModal(false)}>
          <h3>Document Summary</h3>
          <p className="modal-help">
            {pdfSummary.titleGuess ? (
              <>
                <strong>{pdfSummary.titleGuess}</strong>
                {' · '}
              </>
            ) : null}
            {pdfSummary.pageCount} pages · {pdfSummary.wordCount} words
            {pdfSummary.scannedPages > 0 ? ` · ${pdfSummary.scannedPages} scanned/image-only` : ''}
          </p>
          <div className="summary-panel">
            <h4>Overview</h4>
            <p>{pdfSummary.overview}</p>
            {pdfSummary.keyPoints.length > 0 && (
              <>
                <h4>Key points</h4>
                <ul className="summary-list">
                  {pdfSummary.keyPoints.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </>
            )}
            {pdfSummary.extraction.headings.length > 0 && (
              <>
                <h4>Headings</h4>
                <ul className="summary-list">
                  {pdfSummary.extraction.headings.map((heading) => <li key={heading}>{heading}</li>)}
                </ul>
              </>
            )}
            {(pdfSummary.extraction.emails.length > 0
              || pdfSummary.extraction.urls.length > 0
              || pdfSummary.extraction.dates.length > 0) && (
              <>
                <h4>Extracted contacts &amp; dates</h4>
                <ul className="summary-list">
                  {pdfSummary.extraction.emails.map((email) => <li key={`email-${email}`}>{email}</li>)}
                  {pdfSummary.extraction.urls.map((url) => <li key={`url-${url}`}>{url}</li>)}
                  {pdfSummary.extraction.dates.map((date) => <li key={`date-${date}`}>{date}</li>)}
                </ul>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={() => setShowSummaryModal(false)} className="btn btn-secondary">Close</button>
            <button onClick={() => void handleCopySummary()} className="btn">Copy</button>
            <button onClick={() => void handleSaveSummary()} className="btn btn-active">Save summary</button>
          </div>
        </Modal>
      )}

      {showMarkdownSaveAsModal && (
        <Modal onClose={() => setShowMarkdownSaveAsModal(false)}>
          <h3>Save Markdown As</h3>
          <label>Save to path:</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={markdownSaveAsPath}
              onChange={(e) => setMarkdownSaveAsPath(e.target.value)}
              className="modal-input"
              placeholder="/path/to/output.md"
            />
            {nativeDialogs && (
              <button onClick={() => void chooseMarkdownSaveAsNative()} className="btn">Choose location…</button>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={() => setShowMarkdownSaveAsModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleMarkdownSaveAs} className="btn" disabled={!markdownSaveAsPath.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {showPasswordModal && (
        <Modal onClose={() => { setShowPasswordModal(false); setPendingEncryptedPath(''); }}>
          <h3>Password required</h3>
          <p className="modal-help">This PDF is encrypted. Enter the user password to open it.</p>
          <label>Password:</label>
          <input
            type="password"
            value={pdfPasswordDraft}
            onChange={(e) => setPdfPasswordDraft(e.target.value)}
            className="modal-input"
            onKeyDown={(e) => { if (e.key === 'Enter') void handleOpenEncryptedPdf(); }}
          />
          <div className="modal-actions">
            <button onClick={() => { setShowPasswordModal(false); setPendingEncryptedPath(''); }} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleOpenEncryptedPdf()} className="btn" disabled={!pdfPasswordDraft}>Open</button>
          </div>
        </Modal>
      )}

      {showMetadataModal && (
        <Modal onClose={() => setShowMetadataModal(false)}>
          <h3>Document metadata</h3>
          <p className="modal-help">Edits the PDF Info dictionary in the working copy. Save the document to write changes to your file.</p>
          <label>Title:</label>
          <input type="text" value={metadataTitle} onChange={(e) => setMetadataTitle(e.target.value)} className="modal-input" />
          <label>Author:</label>
          <input type="text" value={metadataAuthor} onChange={(e) => setMetadataAuthor(e.target.value)} className="modal-input" />
          <label>Subject:</label>
          <input type="text" value={metadataSubject} onChange={(e) => setMetadataSubject(e.target.value)} className="modal-input" />
          <label>Keywords:</label>
          <input type="text" value={metadataKeywords} onChange={(e) => setMetadataKeywords(e.target.value)} className="modal-input" />
          <label>Creator:</label>
          <input type="text" value={metadataCreator} onChange={(e) => setMetadataCreator(e.target.value)} className="modal-input" />
          <label>Producer:</label>
          <input type="text" value={metadataProducer} onChange={(e) => setMetadataProducer(e.target.value)} className="modal-input" />
          {metadataCreationDate && (
            <p className="modal-help">Creation date: <code>{metadataCreationDate}</code></p>
          )}
          {metadataModDate && (
            <p className="modal-help">Modified date: <code>{metadataModDate}</code></p>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowMetadataModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleSaveMetadata()} className="btn">Apply</button>
          </div>
        </Modal>
      )}

      {showSignModal && (
        <Modal onClose={() => setShowSignModal(false)}>
          <h3>Digital signature</h3>
          <p className="modal-help">
            Sign the open document with a PKCS#12 identity (.p12/.pfx). The signature is embedded in the working copy; use Save to write it to your file.
          </p>
          <label>Certificate (.p12 / .pfx):</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={signCertPath}
              onChange={(e) => setSignCertPath(e.target.value)}
              className="modal-input"
              placeholder="/path/to/identity.p12"
            />
            {nativeDialogs && (
              <button type="button" onClick={() => void chooseSignCertNative()} className="btn">Choose file…</button>
            )}
          </div>
          <label>Certificate password:</label>
          <input
            type="password"
            value={signCertPassword}
            onChange={(e) => setSignCertPassword(e.target.value)}
            className="modal-input"
          />
          <label>Reason (optional):</label>
          <input
            type="text"
            value={signReason}
            onChange={(e) => setSignReason(e.target.value)}
            className="modal-input"
            placeholder="Approved"
          />
          <label>Location (optional):</label>
          <input
            type="text"
            value={signLocation}
            onChange={(e) => setSignLocation(e.target.value)}
            className="modal-input"
            placeholder="Office"
          />
          <div className="modal-actions">
            <button onClick={() => setShowSignModal(false)} className="btn btn-secondary">Cancel</button>
            <button
              onClick={() => void handleSignPdf()}
              className="btn"
              disabled={!signCertPath.trim() || !signCertPassword}
            >
              Sign PDF
            </button>
          </div>
        </Modal>
      )}

      {showProtectModal && (
        <Modal onClose={() => setShowProtectModal(false)}>
          <h3>Password protect</h3>
          <p className="modal-help">Writes an encrypted copy as <code>&lt;name&gt;_protected.pdf</code> beside the working file. The open document stays editable.</p>
          <label>User password:</label>
          <input
            type="password"
            value={protectUserPassword}
            onChange={(e) => setProtectUserPassword(e.target.value)}
            className="modal-input"
          />
          <label>Confirm user password:</label>
          <input
            type="password"
            value={protectUserPasswordConfirm}
            onChange={(e) => setProtectUserPasswordConfirm(e.target.value)}
            className="modal-input"
          />
          <label>Owner password (optional):</label>
          <input
            type="password"
            value={protectOwnerPassword}
            onChange={(e) => setProtectOwnerPassword(e.target.value)}
            className="modal-input"
            placeholder="Defaults to user password"
          />
          <div className="modal-actions">
            <button onClick={() => setShowProtectModal(false)} className="btn btn-secondary">Cancel</button>
            <button
              onClick={() => void handleProtectPdf()}
              className="btn"
              disabled={!protectUserPassword || !protectUserPasswordConfirm}
            >
              Protect
            </button>
          </div>
        </Modal>
      )}

      {showSaveAsModal && (
        <Modal onClose={() => setShowSaveAsModal(false)}>
          <h3>Save As</h3>
          <label>Save to path:</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={saveAsPath}
              onChange={(e) => setSaveAsPath(e.target.value)}
              className="modal-input"
              placeholder="/path/to/output.pdf"
            />
            {nativeDialogs && (
              <button onClick={() => void chooseSaveAsNative()} className="btn">Choose location…</button>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={() => setShowSaveAsModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleSaveAs} className="btn" disabled={!saveAsPath.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {showUnsavedModal && (
        <Modal onClose={() => resolveUnsaved('cancel')}>
          <h3>Unsaved changes</h3>
          <p className="modal-help">You have unsaved edits to this document. Save them before continuing?</p>
          <div className="modal-actions">
            <button onClick={() => resolveUnsaved('cancel')} className="btn btn-secondary">Cancel</button>
            <button onClick={() => resolveUnsaved('discard')} className="btn">Discard</button>
            <button onClick={() => resolveUnsaved('save')} className="btn btn-active">Save</button>
          </div>
        </Modal>
      )}

      {/* PDF Browser Modal */}
      {showBrowserModal && (
        <Modal onClose={() => setShowBrowserModal(false)}>
          <h3>Browse PDF</h3>
          <label>Folder:</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={browserPathInput}
              onChange={(e) => setBrowserPathInput(e.target.value)}
              onKeyDown={(e) => onFieldKeyDown(e, commitBrowserPath)}
              className="modal-input"
            />
            <button onClick={commitBrowserPath} className="btn">Go</button>
          </div>
          <div className="file-browser-list">
            {browserListing?.parentDir && (
              <button className="file-browser-row" onClick={() => loadPdfBrowser(browserListing.parentDir ?? undefined)}>
                <span className="file-browser-kind">Folder</span>
                <span className="file-browser-name">..</span>
              </button>
            )}
            {browserListing?.entries.map((entry) => (
              <button key={entry.path} className="file-browser-row" onClick={() => handleBrowserEntryClick(entry)}>
                <span className="file-browser-kind">{entry.isDir ? 'Folder' : 'PDF'}</span>
                <span className="file-browser-name">{entry.name}</span>
              </button>
            ))}
            {browserListing && browserListing.entries.length === 0 && (
              <p className="muted browser-empty">No folders or PDF files here</p>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={() => setShowBrowserModal(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}

      {/* Print surface — hidden on screen, shown only by the print stylesheet */}
      <div className="print-root">
        {printPages.map((src, i) => (
          <img key={i} src={src} className="print-page" alt={`Print page ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Toast({ notification }: { notification: { message: string; type: 'success' | 'error' } | null }) {
  if (!notification) return null;
  return (
    <div className={`toast toast-${notification.type}`}>
      {notification.message}
    </div>
  );
}

export default App;
