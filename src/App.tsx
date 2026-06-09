import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openNativeDialog, save as saveNativeDialog } from '@tauri-apps/plugin-dialog';
import parityBatchCommands from './parity_batch_commands.json';
import pandaWelcome from './assets/panda.png';
import { TitleBar } from './chrome/TitleBar';
import { buildAppMenus } from './menu/buildAppMenus';
import { MenuChrome } from './menu/MenuChrome';
import { useStructuralEdit } from './pdf/useStructuralEdit';
import { Modal } from './ui/Modal';
import { Toast } from './ui/Toast';
import type { PageRangeScope } from './pageRange/types';
import { resolvePageRange } from './pageRange/resolvePageRange';
import { usePageRange, usePageRangePair } from './pageRange/usePageRange';
import { PageRangeFields, PageRangePairInputs } from './pageRange/PageRangeFields';

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
const TESSERACT_REMIND_DISMISSED_KEY = 'pdf-panda:tesseract-remind-dismissed';
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
  ocrAvailable: boolean;
  ocrLanguage: string;
  pagesNeedingOcr: number;
  ocrTextBlocks: number;
  ocrMissingHints: number;
}

interface MarkdownOcrNotice {
  tone: 'success' | 'warning';
  message: string;
}

const markdownOcrNoticeFromResult = (result: MarkdownSaveResult): MarkdownOcrNotice | null => {
  if (result.pagesNeedingOcr === 0) return null;
  if (result.ocrMissingHints > 0 || result.ocrTextBlocks === 0) {
    return {
      tone: 'warning',
      message: 'Scanned pages — pictures saved, text not read',
    };
  }
  return {
    tone: 'success',
    message: 'Text read from scanned pages',
  };
};

const markdownSaveToastMessage = (result: MarkdownSaveResult): string => {
  const base = result.written
    ? `Markdown saved to ${result.markdownPath}`
    : 'Markdown file is already up to date';
  if (result.pagesNeedingOcr === 0) return base;
  if (result.ocrMissingHints > 0 || result.ocrTextBlocks === 0) {
    return `${base}. Some pages are scans — pictures were saved, but their text couldn't be read.`;
  }
  return `${base}. Text was read from scanned pages.`;
};

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

interface PdfPageSize {
  width: number;
  height: number;
  rotation: number;
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

type PdfBrowserTarget = 'open' | 'insert' | 'merge' | 'replace' | 'interleave' | 'prepend';
type PngExportScope = PageRangeScope;
type ImageExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff' | 'gif' | 'ppm' | 'tga' | 'ico';
type PageSizePreset = 'letter' | 'a4' | 'legal';

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

const isTesseractReminderDismissed = () => readStoredString(TESSERACT_REMIND_DISMISSED_KEY) === '1';

const dismissTesseractReminder = () => writeStoredString(TESSERACT_REMIND_DISMISSED_KEY, '1');

interface TesseractInstallGuide {
  platform: string;
  summary: string;
  steps: string[];
  installCommand: string | null;
  downloadUrl: string | null;
  licenseNote: string;
}

const DEFAULT_TESSERACT_GUIDE: TesseractInstallGuide = {
  platform: 'unknown',
  summary:
    'Tesseract lets PDF Panda read text from scanned PDF pages. Normal PDFs with selectable text work without it.',
  steps: [
    'Install Tesseract with English language support for your operating system.',
    'Restart PDF Panda.',
  ],
  installCommand: null,
  downloadUrl: 'https://github.com/tesseract-ocr/tesseract',
  licenseNote: 'Tesseract is free, open-source software. You do not need to pay for it.',
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
const PNG_DIALOG_FILTER = [{ name: 'PNG', extensions: ['png'] }];
const JPEG_DIALOG_FILTER = [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }];
const WEBP_DIALOG_FILTER = [{ name: 'WebP', extensions: ['webp'] }];
const BMP_DIALOG_FILTER = [{ name: 'BMP', extensions: ['bmp'] }];
const TIFF_DIALOG_FILTER = [{ name: 'TIFF', extensions: ['tiff', 'tif'] }];
const GIF_DIALOG_FILTER = [{ name: 'GIF', extensions: ['gif'] }];
const PPM_DIALOG_FILTER = [{ name: 'PPM', extensions: ['ppm', 'pnm'] }];
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
  const handleMarkdownViewRef = useRef(async () => {});
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


  const imageExportExtension = (format: ImageExportFormat) => {
    if (format === 'jpeg') return 'jpg';
    if (format === 'webp') return 'webp';
    if (format === 'bmp') return 'bmp';
    if (format === 'tiff') return 'tiff';
    if (format === 'gif') return 'gif';
    if (format === 'ppm') return 'ppm';
    if (format === 'tga') return 'tga';
    if (format === 'ico') return 'ico';
    return 'png';
  };

  const defaultImageExportOutput = (format: ImageExportFormat, scope: PngExportScope, start: number, _end: number) => {
    const base = (originalPath || filePath).replace(/\.pdf$/i, '');
    const ext = imageExportExtension(format);
    if (scope === 'current') return `${base}_page_${start + 1}.${ext}`;
    return `${base}_pages`;
  };

  const imageExportCommand = (format: ImageExportFormat, multi: boolean) => {
    if (multi) {
      if (format === 'jpeg') return 'export_pdf_pages_jpeg';
      if (format === 'webp') return 'export_pdf_pages_webp';
      if (format === 'bmp') return 'export_pdf_pages_bmp';
      if (format === 'tiff') return 'export_pdf_pages_tiff';
      if (format === 'gif') return 'export_pdf_pages_gif';
      if (format === 'ppm') return 'export_pdf_pages_ppm';
      if (format === 'tga') return 'export_pdf_pages_tga';
      if (format === 'ico') return 'export_pdf_pages_ico';
      return 'export_pdf_pages_png';
    }
    if (format === 'jpeg') return 'export_pdf_page_jpeg';
    if (format === 'webp') return 'export_pdf_page_webp';
    if (format === 'bmp') return 'export_pdf_page_bmp';
    if (format === 'tiff') return 'export_pdf_page_tiff';
    if (format === 'gif') return 'export_pdf_page_gif';
    if (format === 'ppm') return 'export_pdf_page_ppm';
    if (format === 'tga') return 'export_pdf_page_tga';
    if (format === 'ico') return 'export_pdf_page_ico';
    return 'export_pdf_page_png';
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
    const label = imageExportFormat === 'webp' ? 'WebP' : imageExportFormat === 'bmp' ? 'BMP' : imageExportFormat === 'tiff' ? 'TIFF' : imageExportFormat === 'gif' ? 'GIF' : imageExportFormat === 'ppm' ? 'PPM' : imageExportFormat.toUpperCase();
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

  const reloadOpenPdf = async (nextPage = currentPage) => {
    if (!filePath) return;
    const count = await invoke<number>('get_pdf_page_count', { path: filePath });
    const page = Math.max(0, Math.min(nextPage, count - 1));
    setPageCount(count);
    setCurrentPage(page);
    setPageInput(String(page + 1));
    setViewMode('pdf');
    await renderPage(filePath, page);
    await loadThumbnails(filePath);
    void loadPdfBookmarks(filePath);
    void loadPageSizes(filePath);
  };

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

  const parityImageExportCommand = (format: ImageExportFormat, odd: boolean): string | null => {
    const side = odd ? 'odd' : 'even';
    if (format === 'png') return `export_${side}_pages_png`;
    if (format === 'jpeg') return `export_${side}_pages_jpeg`;
    if (format === 'webp') return `export_${side}_pages_webp`;
    if (format === 'bmp') return `export_${side}_pages_bmp`;
    if (format === 'tiff') return `export_${side}_pages_tiff`;
    if (format === 'gif') return `export_${side}_pages_gif`;
    if (format === 'ppm') return `export_${side}_pages_ppm`;
    if (format === 'tga') return `export_${side}_pages_tga`;
    if (format === 'ico') return `export_${side}_pages_ico`;
    return null;
  };

  const isParityDocModCommand = (command: string) => {
    if (command.includes('_in_range')) return false;
    return /_mod3_[0-2]_/.test(command)
      || /_mod4_[0-3]_/.test(command)
      || /_mod5_[0-4]_/.test(command)
      || /_mod6_[0-5]_/.test(command);
  };

  const parityBatchNeedsRange = (command: string) =>
    !isParityDocModCommand(command)
    && command !== 'export_odd_pages_ico'
    && command !== 'export_even_pages_ico';

  const parityBatchMutatesPdf = (command: string) => !command.startsWith('export_') && !command.startsWith('extract_');

  const buildParityBatchPayload = (command: string): Record<string, unknown> => {
    const docWide = isParityDocModCommand(command)
      || command === 'export_odd_pages_ico'
      || command === 'export_even_pages_ico';
    if (docWide) {
      const pathOnly = { path: filePath };
      if (command.startsWith('extract_')) {
        return { ...pathOnly, outputPath: parityRangeOutputPath.trim() };
      }
      if (command.startsWith('export_')) {
        return { ...pathOnly, outputDir: parityRangeOutputPath.trim() };
      }
      if (command.includes('crop_') || command.includes('expand_') || command.includes('shrink_')) {
        return {
          ...pathOnly,
          marginTop: cropMarginTop,
          marginRight: cropMarginRight,
          marginBottom: cropMarginBottom,
          marginLeft: cropMarginLeft,
        };
      }
      if (command.includes('watermark')) {
        return { ...pathOnly, text: watermarkText.trim() };
      }
      if (command.includes('header')) {
        return { ...pathOnly, text: pageHeaderText.trim() };
      }
      if (command.includes('footer')) {
        return { ...pathOnly, text: pageFooterText.trim() };
      }
      if (command.includes('border')) {
        return { ...pathOnly, inset: pageBorderInset };
      }
      if (command.includes('page_size')) {
        return { ...pathOnly, preset: pageSizePreset };
      }
      if (command.includes('bookmark') || command.includes('page_numbers')) {
        return { ...pathOnly, prefix: pageNumbersPrefix.trim() || null };
      }
      if (command.includes('_by_rotation') || command.includes('_by_size')) {
        return { ...pathOnly, descending: false };
      }
      return pathOnly;
    }
    const base = {
      path: filePath,
      startPage: parityRange.startPage,
      endPage: parityRange.endPage,
    };
    if (command.startsWith('extract_')) {
      return { ...base, outputPath: parityRangeOutputPath.trim() };
    }
    if (command.startsWith('export_')) {
      return { ...base, outputDir: parityRangeOutputPath.trim() };
    }
    if (command.includes('crop_') || command.includes('expand_') || command.includes('shrink_')) {
      return {
        ...base,
        marginTop: cropMarginTop,
        marginRight: cropMarginRight,
        marginBottom: cropMarginBottom,
        marginLeft: cropMarginLeft,
      };
    }
    if (command.includes('watermark')) {
      return { ...base, text: watermarkText.trim() };
    }
    if (command.includes('header')) {
      return { ...base, text: pageHeaderText.trim() };
    }
    if (command.includes('footer')) {
      return { ...base, text: pageFooterText.trim() };
    }
    if (command.includes('border')) {
      return { ...base, inset: pageBorderInset };
    }
    if (command.includes('page_size')) {
      return { ...base, preset: pageSizePreset };
    }
    if (command.includes('bookmark') || command.includes('page_numbers')) {
      return { ...base, prefix: pageNumbersPrefix.trim() || null };
    }
    return base;
  };

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
    if ((command.includes('watermark') || command.includes('header') || command.includes('footer'))
      && !buildParityBatchPayload(command).text) {
      showToast('Text is required for this action', 'error');
      return;
    }
    await withLoading(async () => {
      const payload = buildParityBatchPayload(command);
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
    const command = parityImageExportCommand(imageExportFormat, true);
    if (!command) {
      showToast('Unsupported image format', 'error');
      return;
    }
    await withLoading(async () => {
      const written = await invoke<string[]>(command, { path: filePath, outputDir });
      setShowExportPngModal(false);
      showToast(`Exported ${written.length} odd page image${written.length === 1 ? '' : 's'} to ${outputDir}`);
    });
  };

  const handleExportEvenPagesImage = async () => {
    const outputDir = pngExportOutputPath.trim();
    if (!filePath || !outputDir) return;
    const command = parityImageExportCommand(imageExportFormat, false);
    if (!command) {
      showToast('Unsupported image format', 'error');
      return;
    }
    await withLoading(async () => {
      const written = await invoke<string[]>(command, { path: filePath, outputDir });
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

  const removeRedaction = (index: number) => {
    void runEdit({
      command: 'remove_redaction',
      args: { pageIndex: currentPage, index },
      afterEdit: async () => { await refreshAnnotations(); },
      toast: 'Redaction removed',
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
    void runEdit({ command: 'remove_ink_stroke', args: { pageIndex: currentPage, index: inkIndex }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Drawing removed' });
  };

  // Click an existing highlight (while in highlight mode) to remove it.
  const removeHighlight = (highlightIndex: number) => {
    void runEdit({ command: 'remove_highlight', args: { pageIndex: currentPage, index: highlightIndex }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Highlight removed' });
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
    void runEdit({ command: 'remove_text_note', args: { pageIndex: currentPage, index: noteIndex }, afterEdit: async () => { await refreshAnnotations(); }, toast: 'Note removed' });
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
    setShowMergeModal(false);
    setShowSearchModal(false);
    setActiveSearchRect(null);
    setShowImageInsertModal(false);
    setShowAddFormFieldModal(false);
    setShowSummaryModal(false);
    setShowPageTextModal(false);
    setShowPageEditsModal(false);
    setShowCommandPalette(false);
    setShowShortcutsHelp(false);
    setShowLicenses(false);
    setShowCredits(false);
    setShowAbout(false);
    setShowTesseractModal(false);
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

  // Commit-on-Enter helper for the numeric fields (Tab / click-out commit via onBlur).
  const onFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (e.key === 'Enter') {
      commit();
      e.currentTarget.blur();
    }
  };

  const appMenus = buildAppMenus({
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
    handleRotatePageCcw: () => void handleRotatePageCcw(),
    handleResetPageRotation: () => void handleResetPageRotation(),
    handleRotatePage180: () => void handleRotatePage180(),
    handleRotateAllPages: () => void handleRotateAllPages(),
    handleRotateAllPagesCcw: () => void handleRotateAllPagesCcw(),
    handleRotateAllPages180: () => void handleRotateAllPages180(),
    handleRotateOddPages: () => void handleRotateOddPages(),
    handleRotateEvenPages: () => void handleRotateEvenPages(),
    handleRotateOddPagesCcw: () => void handleRotateOddPagesCcw(),
    handleRotateEvenPagesCcw: () => void handleRotateEvenPagesCcw(),
    handleRotate180OddPages: () => void handleRotate180OddPages(),
    handleRotate180EvenPages: () => void handleRotate180EvenPages(),
    handleResetRotationOddPages: () => void handleResetRotationOddPages(),
    handleResetRotationEvenPages: () => void handleResetRotationEvenPages(),
    handleResetAllRotations: () => void handleResetAllRotations(),
    openRotateRangeModal,
    handleDuplicatePage,
    handleDuplicatePageBefore: () => void handleDuplicatePageBefore(),
    openDuplicateRangeModal,
    openParityRangeModal,
    openMoveRangeModal,
    openKeepRangeModal,
    handleKeepOddPages: () => void handleKeepOddPages(),
    handleKeepEvenPages: () => void handleKeepEvenPages(),
    handleDeleteOddPages: () => void handleDeleteOddPages(),
    handleDeleteEvenPages: () => void handleDeleteEvenPages(),
    handleAddBlankPage: () => void handleAddBlankPage(),
    handleAddBlankPageBefore: () => void handleAddBlankPageBefore(),
    openInsertBlankPagesModal,
    handleInsertBlankBetweenPages: () => void handleInsertBlankBetweenPages(),
    handleInsertBlankBeforeOddPages: () => void handleInsertBlankBeforeOddPages(),
    handleInsertBlankBeforeEvenPages: () => void handleInsertBlankBeforeEvenPages(),
    handleInsertBlankAfterOddPages: () => void handleInsertBlankAfterOddPages(),
    handleInsertBlankAfterEvenPages: () => void handleInsertBlankAfterEvenPages(),
    handleMovePageToFirst: () => void handleMovePageToFirst(),
    handleMovePageToLast: () => void handleMovePageToLast(),
    handleMovePageUp: () => void handleMovePageUp(),
    handleMovePageDown: () => void handleMovePageDown(),
    openSwapPagesModal,
    handleReversePages: () => void handleReversePages(),
    openReverseRangeModal,
    handleReverseOddPages: () => void handleReverseOddPages(),
    handleReverseEvenPages: () => void handleReverseEvenPages(),
    handleMoveOddPagesToStart: () => void handleMoveOddPagesToStart(),
    handleMoveEvenPagesToStart: () => void handleMoveEvenPagesToStart(),
    handleMoveOddPagesToEnd: () => void handleMoveOddPagesToEnd(),
    handleMoveEvenPagesToEnd: () => void handleMoveEvenPagesToEnd(),
    handleSplitOddEven: () => void handleSplitOddEven(),
    handleDuplicateAllPages: () => void handleDuplicateAllPages(),
    handleDuplicatePageToEnd: () => void handleDuplicatePageToEnd(),
    handleDuplicateOddPages: () => void handleDuplicateOddPages(),
    handleDuplicateEvenPages: () => void handleDuplicateEvenPages(),
    handleDuplicateOddPagesBefore: () => void handleDuplicateOddPagesBefore(),
    handleDuplicateEvenPagesBefore: () => void handleDuplicateEvenPagesBefore(),
    handleDuplicateOddPagesToEnd: () => void handleDuplicateOddPagesToEnd(),
    handleDuplicateEvenPagesToEnd: () => void handleDuplicateEvenPagesToEnd(),
    handleDuplicateOddPagesToStart: () => void handleDuplicateOddPagesToStart(),
    handleDuplicateEvenPagesToStart: () => void handleDuplicateEvenPagesToStart(),
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
    handleCropOddPages: () => void handleCropOddPages(),
    handleCropEvenPages: () => void handleCropEvenPages(),
    openExpandMarginsModal,
    openShrinkMarginsModal,
    openPageBorderModal,
    openFlattenModal,
    handleFlattenAllAnnotations: () => void handleFlattenAllAnnotations(),
    handleFlattenOddPages: () => void handleFlattenOddPages(),
    handleFlattenEvenPages: () => void handleFlattenEvenPages(),
    handleSortPagesBySize: (desc) => void handleSortPagesBySize(desc),
    handleSortOddPagesBySize: (desc) => void handleSortOddPagesBySize(desc),
    handleSortEvenPagesBySize: (desc) => void handleSortEvenPagesBySize(desc),
    handleSortPagesByRotation: (desc) => void handleSortPagesByRotation(desc),
    handleSortOddPagesByRotation: (desc) => void handleSortOddPagesByRotation(desc),
    handleSortEvenPagesByRotation: (desc) => void handleSortEvenPagesByRotation(desc),
    openMetadataModal: () => void openMetadataModal(),
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
  });

  const modeToolbarExtras = filePath ? (
    <>
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
    </>
  ) : null;

  const windowTitle = originalPath
    ? `${isDirty ? '• ' : ''}${originalPath.split('/').pop() ?? ''} — PDF Panda`
    : 'PDF Panda';

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
              {pageSizes[currentPage] && (
                <span className="muted" title="Page size in PDF points">
                  {' '}· {Math.round(pageSizes[currentPage].width)}×{Math.round(pageSizes[currentPage].height)}pt
                  {pageSizes[currentPage].rotation !== 0 ? ` · ${pageSizes[currentPage].rotation}°` : ''}
                </span>
              )}
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

      <div className="app-body">
      {/* Sidebar — only when a PDF is open */}
      {filePath && (
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
              <button type="button" onClick={openAddBookmarkModal} className="btn" title="Add bookmark at current page">
                Add
              </button>
              <button type="button" onClick={openBookmarkAllModal} className="btn" title="Bookmark every page">
                All
              </button>
              <button type="button" onClick={() => void handleClearAllBookmarks()} className="btn" title="Remove all bookmarks">
                Clear
              </button>
              <button type="button" onClick={() => void loadPdfBookmarks(filePath)} className="btn" title="Reload bookmarks">
                Refresh
              </button>
            </div>
            {pdfBookmarks.length === 0 ? (
              <p className="muted">No bookmarks in this PDF.</p>
            ) : (
              <div className="bookmark-list">
                {pdfBookmarks.map((bookmark, index) => (
                  <div
                    key={`${bookmark.title}-${index}`}
                    className={`bookmark-row-wrap ${bookmark.page_index === currentPage ? 'active' : ''}`}
                    style={{ paddingLeft: `${12 + bookmark.depth * 14}px` }}
                  >
                    <button
                      type="button"
                      className="bookmark-row"
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
                    <button type="button" className="btn btn-secondary" title="Rename bookmark" onClick={() => openRenameBookmarkModal(index, bookmark.title)}>✎</button>
                    <button type="button" className="btn btn-secondary" title="Remove bookmark" onClick={() => void handleRemoveBookmark(index)}>×</button>
                  </div>
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
      )}

      {/* Main Content */}
      <main className="main">
        {/* Scrollable page area */}
        <div
          className={`page-scroll${!filePath ? ' welcome-scroll' : ''}${viewMode === 'markdown' ? ' markdown-scroll' : ''}`}
          ref={scrollRef}
          onWheel={handleWheel}
        >
          {!filePath ? (
            <button
              type="button"
              className="welcome-splash"
              onClick={openPdf}
              data-testid="welcome-open-pdf"
              aria-label="Click to open a PDF"
            >
              <img src={pandaWelcome} alt="" className="welcome-panda" aria-hidden="true" />
              <span className="welcome-hint">Click to open a PDF</span>
            </button>
          ) : viewMode === 'markdown' ? (
            <div className="markdown-viewer">
              <div className="markdown-header">
                <span>Markdown</span>
                {markdownOcrNotice && (
                  <span className={`markdown-ocr-badge ${markdownOcrNotice.tone === 'success' ? 'ready' : 'missing'}`}>
                    {markdownOcrNotice.message}
                  </span>
                )}
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
                <p className="muted">No page rendered.</p>
              )}
            </div>
          )}
        </div>
      </main>
      </div>

      {/* Open Modal */}
      {showOpenModal && (
        <Modal onClose={() => setShowOpenModal(false)}>
          <h3>Open PDF</h3>
          {!nativeDialogs && (
            <p className="modal-help">Native file picker is disabled for this session. Enter a path or use Browse….</p>
          )}
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

      {/* Export Image Modal */}
      {showExportPngModal && (
        <Modal onClose={() => setShowExportPngModal(false)}>
          <h3>Export Image</h3>
          <p className="modal-help">Render PDF pages to PNG, JPEG, WebP, BMP, TIFF, GIF, PPM, TGA, or ICO images (1600×2264). The open PDF is not modified.</p>
          <label>Format:</label>
          <select
            className="modal-input"
            value={imageExportFormat}
            onChange={(e) => {
              const format = e.target.value as ImageExportFormat;
              setImageExportFormat(format);
              const start = pngExportRange.scope === 'current' ? currentPage : pngExportRange.startPage;
              const end = pngExportRange.scope === 'all' ? (pageCount ?? 1) - 1 : pngExportRange.scope === 'current' ? currentPage : pngExportRange.endPage;
              setPngExportOutputPath(defaultImageExportOutput(format, pngExportRange.scope, start, end));
            }}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="bmp">BMP</option>
            <option value="tiff">TIFF</option>
            <option value="gif">GIF</option>
            <option value="ppm">PPM</option>
            <option value="tga">TGA</option>
            <option value="ico">ICO</option>
          </select>
          <label>Pages to export:</label>
          <select
            className="modal-input"
            value={pngExportRange.scope}
            onChange={(e) => {
              const scope = e.target.value as PngExportScope;
              pngExportRange.setScope(scope);
              const resolved = resolvePageRange(scope, pngExportRange.startPage, pngExportRange.endPage, currentPage, pageCount);
              setPngExportOutputPath(defaultImageExportOutput(imageExportFormat, scope, resolved.start, resolved.end));
            }}
          >
            <option value="current">Current page only</option>
            <option value="range">Page range</option>
            <option value="all">All pages</option>
          </select>
          {pngExportRange.scope === 'range' && (
            <PageRangePairInputs
              startPage={pngExportRange.startPage}
              endPage={pngExportRange.endPage}
              onStartChange={(start) => {
                pngExportRange.setStartPage(start);
                setPngExportOutputPath(defaultImageExportOutput(imageExportFormat, 'range', start, pngExportRange.endPage));
              }}
              onEndChange={(end) => {
                pngExportRange.setEndPage(end);
                setPngExportOutputPath(defaultImageExportOutput(imageExportFormat, 'range', pngExportRange.startPage, end));
              }}
              maxPage={pageCount ?? undefined}
            />
          )}
          <label>{pngExportRange.scope === 'current' ? 'Output file path:' : 'Output directory:'}</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={pngExportOutputPath}
              onChange={(e) => setPngExportOutputPath(e.target.value)}
              className="modal-input"
              placeholder={pngExportRange.scope === 'current' ? '/path/to/page.png' : '/path/to/output_dir'}
            />
            {nativeDialogs && (
              <button onClick={() => void chooseExportPngOutputNative()} className="btn">Choose…</button>
            )}
          </div>
          {pngExportRange.scope !== 'current' && (
            <p className="modal-help">
              Files are written as page-001.{imageExportExtension(imageExportFormat)}, page-002.{imageExportExtension(imageExportFormat)}, … inside the directory.
            </p>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowExportPngModal(false)} className="btn btn-secondary">Cancel</button>
            {pngExportRange.scope !== 'current' && (
              <>
                <button onClick={() => void handleExportOddPagesImage()} className="btn" disabled={!pngExportOutputPath.trim()}>Export Odd</button>
                <button onClick={() => void handleExportEvenPagesImage()} className="btn" disabled={!pngExportOutputPath.trim()}>Export Even</button>
              </>
            )}
            <button onClick={() => void handleExportPng()} className="btn" disabled={!pngExportOutputPath.trim()}>Export</button>
          </div>
        </Modal>
      )}

      {/* Delete Range Modal */}
      {showDeleteRangeModal && (
        <Modal onClose={() => setShowDeleteRangeModal(false)}>
          <h3>Delete Page Range</h3>
          <p className="modal-help">Remove multiple pages from the working copy. At least one page must remain.</p>
          <PageRangePairInputs
            startPage={deleteRange.startPage}
            endPage={deleteRange.endPage}
            onStartChange={deleteRange.setStartPage}
            onEndChange={deleteRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <div className="modal-actions">
            <button onClick={() => setShowDeleteRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleDeletePageRange()} className="btn btn-danger">Delete range</button>
          </div>
        </Modal>
      )}

      {/* Page Numbers Modal */}
      {showPageNumbersModal && (
        <Modal onClose={() => setShowPageNumbersModal(false)}>
          <h3>Page Numbers</h3>
          <p className="modal-help">Stamp footer page numbers onto the working copy.</p>
          <PageRangeFields range={pageNumbersRange} pageCount={pageCount} />
          <label>Prefix (e.g. &quot;Page &quot;):</label>
          <input type="text" value={pageNumbersPrefix} onChange={(e) => setPageNumbersPrefix(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowPageNumbersModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleAddPageNumbersOddPages()} className="btn">Apply Odd</button>
            <button onClick={() => void handleAddPageNumbersEvenPages()} className="btn">Apply Even</button>
            <button onClick={() => void handleAddPageNumbers()} className="btn">Apply</button>
          </div>
        </Modal>
      )}

      {/* Watermark Modal */}
      {showWatermarkModal && (
        <Modal onClose={() => setShowWatermarkModal(false)}>
          <h3>Text Watermark</h3>
          <p className="modal-help">Add a diagonal watermark to the working copy.</p>
          <label>Watermark text:</label>
          <input type="text" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} className="modal-input" />
          <PageRangeFields range={watermarkRange} pageCount={pageCount} />
          <div className="modal-actions">
            <button onClick={() => setShowWatermarkModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleAddWatermarkOddPages()} className="btn" disabled={!watermarkText.trim()}>Apply Odd</button>
            <button onClick={() => void handleAddWatermarkEvenPages()} className="btn" disabled={!watermarkText.trim()}>Apply Even</button>
            <button onClick={() => void handleAddWatermark()} className="btn" disabled={!watermarkText.trim()}>Apply</button>
          </div>
        </Modal>
      )}

      {/* Crop Modal */}
      {showCropModal && (
        <Modal onClose={() => setShowCropModal(false)}>
          <h3>Crop {cropApplyAll ? 'All Pages' : `Page ${currentPage + 1}`}</h3>
          <p className="modal-help">Trim margins (viewer pixels, max ~800×1132).</p>
          {pageSizes[currentPage] && !cropApplyAll && (
            <p className="muted">MediaBox: {Math.round(pageSizes[currentPage].width)}×{Math.round(pageSizes[currentPage].height)} pt</p>
          )}
          <label>
            <input type="checkbox" checked={cropApplyAll} onChange={(e) => setCropApplyAll(e.target.checked)} />
            {' '}Apply to all pages
          </label>
          <label>Top margin: <input type="number" value={cropMarginTop} onChange={(e) => setCropMarginTop(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Right margin: <input type="number" value={cropMarginRight} onChange={(e) => setCropMarginRight(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Bottom margin: <input type="number" value={cropMarginBottom} onChange={(e) => setCropMarginBottom(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Left margin: <input type="number" value={cropMarginLeft} onChange={(e) => setCropMarginLeft(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <div className="modal-actions">
            <button onClick={() => setShowCropModal(false)} className="btn btn-secondary">Cancel</button>
            {!cropApplyAll && (
              <button onClick={() => void handleClearPageCrop()} className="btn btn-secondary">Clear crop</button>
            )}
            <button onClick={() => void handleClearAllCrops()} className="btn btn-secondary">Clear all crops</button>
            <button onClick={() => void handleClearCropOddPages()} className="btn btn-secondary">Clear odd crops</button>
            <button onClick={() => void handleClearCropEvenPages()} className="btn btn-secondary">Clear even crops</button>
            <button onClick={() => void handleCropPage()} className="btn">Crop</button>
          </div>
        </Modal>
      )}

      {/* Duplicate Range Modal */}
      {showDuplicateRangeModal && (
        <Modal onClose={() => setShowDuplicateRangeModal(false)}>
          <h3>Duplicate Page Range</h3>
          <p className="modal-help">Deep-copy a page range and insert the copies immediately after the range.</p>
          <PageRangePairInputs
            startPage={duplicateRange.startPage}
            endPage={duplicateRange.endPage}
            onStartChange={duplicateRange.setStartPage}
            onEndChange={duplicateRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <div className="modal-actions">
            <button onClick={() => setShowDuplicateRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleDuplicatePageRange()} className="btn">Duplicate</button>
            <button onClick={() => void handleDuplicatePageRangeBefore()} className="btn">Before</button>
            <button onClick={() => void handleDuplicatePageRangeToStart()} className="btn">To Start</button>
            <button onClick={() => void handleDuplicatePageRangeToEnd()} className="btn">To End</button>
          </div>
        </Modal>
      )}

      {/* Flatten Modal */}
      {showFlattenModal && (
        <Modal onClose={() => setShowFlattenModal(false)}>
          <h3>Flatten Annotations</h3>
          <p className="modal-help">Remove highlight, note, and other annotation objects from selected pages.</p>
          <PageRangeFields range={flattenRange} pageCount={pageCount} />
          <div className="modal-actions">
            <button onClick={() => setShowFlattenModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleFlattenAnnotations()} className="btn">Flatten</button>
          </div>
        </Modal>
      )}

      {/* Add Bookmark Modal */}
      {showAddBookmarkModal && (
        <Modal onClose={() => setShowAddBookmarkModal(false)}>
          <h3>Add Bookmark</h3>
          <p className="modal-help">Create an outline entry pointing at page {currentPage + 1}.</p>
          <label>Title:</label>
          <input type="text" value={bookmarkTitle} onChange={(e) => setBookmarkTitle(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowAddBookmarkModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleAddBookmark()} className="btn" disabled={!bookmarkTitle.trim()}>Add</button>
          </div>
        </Modal>
      )}

      {/* Page Header Modal */}
      {showPageHeaderModal && (
        <Modal onClose={() => setShowPageHeaderModal(false)}>
          <h3>Page Header</h3>
          <p className="modal-help">Stamp header text near the top of selected pages.</p>
          <label>Header text:</label>
          <input type="text" value={pageHeaderText} onChange={(e) => setPageHeaderText(e.target.value)} className="modal-input" />
          <PageRangeFields range={pageHeaderRange} pageCount={pageCount} />
          <div className="modal-actions">
            <button onClick={() => setShowPageHeaderModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleAddPageHeaderOddPages()} className="btn" disabled={!pageHeaderText.trim()}>Apply Odd</button>
            <button onClick={() => void handleAddPageHeaderEvenPages()} className="btn" disabled={!pageHeaderText.trim()}>Apply Even</button>
            <button onClick={() => void handleAddPageHeader()} className="btn" disabled={!pageHeaderText.trim()}>Apply</button>
          </div>
        </Modal>
      )}

      {/* Page Footer Modal */}
      {showPageFooterModal && (
        <Modal onClose={() => setShowPageFooterModal(false)}>
          <h3>Page Footer</h3>
          <p className="modal-help">Stamp footer text near the bottom of selected pages.</p>
          <label>Footer text:</label>
          <input type="text" value={pageFooterText} onChange={(e) => setPageFooterText(e.target.value)} className="modal-input" />
          <PageRangeFields range={pageFooterRange} pageCount={pageCount} />
          <div className="modal-actions">
            <button onClick={() => setShowPageFooterModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleAddPageFooterOddPages()} className="btn" disabled={!pageFooterText.trim()}>Apply Odd</button>
            <button onClick={() => void handleAddPageFooterEvenPages()} className="btn" disabled={!pageFooterText.trim()}>Apply Even</button>
            <button onClick={() => void handleAddPageFooter()} className="btn" disabled={!pageFooterText.trim()}>Apply</button>
          </div>
        </Modal>
      )}

      {/* Swap Pages Modal */}
      {showSwapPagesModal && (
        <Modal onClose={() => setShowSwapPagesModal(false)}>
          <h3>Swap Pages</h3>
          <p className="modal-help">Exchange the positions of two pages in the working copy.</p>
          <label>Page A (1-{pageCount ?? 0}): <input type="number" value={swapPageA + 1} onChange={(e) => setSwapPageA(Math.max(0, parseInt(e.target.value, 10) - 1))} min="1" max={pageCount ?? undefined} className="modal-input" /></label>
          <label>Page B (1-{pageCount ?? 0}): <input type="number" value={swapPageB + 1} onChange={(e) => setSwapPageB(Math.max(0, parseInt(e.target.value, 10) - 1))} min="1" max={pageCount ?? undefined} className="modal-input" /></label>
          <div className="modal-actions">
            <button onClick={() => setShowSwapPagesModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleSwapPages()} className="btn" disabled={swapPageA === swapPageB}>Swap</button>
          </div>
        </Modal>
      )}

      {/* Replace Page Modal */}
      {showReplacePageModal && (
        <Modal onClose={() => setShowReplacePageModal(false)}>
          <h3>Replace Page {currentPage + 1}</h3>
          <p className="modal-help">Replace the current page with a deep-copied page from another PDF.</p>
          <label>Source PDF path:</label>
          <div className="modal-path-row">
            <input type="text" value={replaceSourcePath} onChange={(e) => void handleReplaceSourcePathChange(e.target.value)} className="modal-input" placeholder="/path/to/source.pdf" />
            <button onClick={() => openPdfBrowser('replace')} className="btn">Browse…</button>
          </div>
          {replaceSourcePageCount !== null && (
            <label>Source page (1-{replaceSourcePageCount}): <input type="number" value={replaceSourcePage + 1} onChange={(e) => setReplaceSourcePage(Math.max(0, parseInt(e.target.value, 10) - 1))} min="1" max={replaceSourcePageCount} className="modal-input" /></label>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowReplacePageModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleReplacePage()} className="btn" disabled={!replaceSourcePath.trim()}>Replace</button>
          </div>
        </Modal>
      )}

      {/* Interleave Modal */}
      {showInterleaveModal && (
        <Modal onClose={() => setShowInterleaveModal(false)}>
          <h3>Interleave PDF</h3>
          <p className="modal-help">Alternate pages: A0, B0, A1, B1, … from the source range.</p>
          <label>Source PDF path:</label>
          <div className="modal-path-row">
            <input type="text" value={interleaveFilePath} onChange={(e) => void handleInterleaveSourcePathChange(e.target.value)} className="modal-input" placeholder="/path/to/source.pdf" />
            <button onClick={() => openPdfBrowser('interleave')} className="btn">Browse…</button>
          </div>
          {interleaveSourcePageCount !== null && (
            <>
              <PageRangePairInputs
                startPage={interleaveRange.startPage}
                endPage={interleaveRange.endPage}
                onStartChange={interleaveRange.setStartPage}
                onEndChange={interleaveRange.setEndPage}
                maxPage={interleaveSourcePageCount ?? undefined}
              />
            </>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowInterleaveModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleInterleavePdf()} className="btn" disabled={!interleaveFilePath.trim()}>Interleave</button>
          </div>
        </Modal>
      )}

      {/* Page Size Modal */}
      {showPageSizeModal && (
        <Modal onClose={() => setShowPageSizeModal(false)}>
          <h3>Page Size</h3>
          <p className="modal-help">Set MediaBox to a standard paper size (content is not scaled).</p>
          <label>Preset:</label>
          <select className="modal-input" value={pageSizePreset} onChange={(e) => setPageSizePreset(e.target.value as PageSizePreset)}>
            <option value="letter">Letter (612×792 pt)</option>
            <option value="a4">A4 (595×842 pt)</option>
            <option value="legal">Legal (612×1008 pt)</option>
          </select>
          <PageRangeFields range={pageSizeRange} pageCount={pageCount} />
          <div className="modal-actions">
            <button onClick={() => setShowPageSizeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleSetPageSizeOddPages()} className="btn">Apply Odd</button>
            <button onClick={() => void handleSetPageSizeEvenPages()} className="btn">Apply Even</button>
            <button onClick={() => void handleSetPageSize()} className="btn">Apply</button>
          </div>
        </Modal>
      )}

      {/* Export Pages as PDF Modal */}
      {showExportPagesPdfModal && (
        <Modal onClose={() => setShowExportPagesPdfModal(false)}>
          <h3>Export Pages as PDF</h3>
          <p className="modal-help">Write each page as a separate single-page PDF. The open document is not modified.</p>
          <PageRangeFields range={exportPagesPdfRange} pageCount={pageCount} applyLabel="Pages to export:" />
          <label>Output directory:</label>
          <input type="text" value={exportPagesPdfOutputDir} onChange={(e) => setExportPagesPdfOutputDir(e.target.value)} className="modal-input" placeholder="/path/to/output_dir" />
          <p className="modal-help">Files are written as page-001.pdf, page-002.pdf, … inside the directory.</p>
          <div className="modal-actions">
            <button onClick={() => setShowExportPagesPdfModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleExportOddPagesAsPdf()} className="btn" disabled={!exportPagesPdfOutputDir.trim()}>Export Odd</button>
            <button onClick={() => void handleExportEvenPagesAsPdf()} className="btn" disabled={!exportPagesPdfOutputDir.trim()}>Export Even</button>
            <button onClick={() => void handleExportPagesPdf()} className="btn" disabled={!exportPagesPdfOutputDir.trim()}>Export</button>
          </div>
        </Modal>
      )}

      {/* Rotate Range Modal */}
      {showRotateRangeModal && (
        <Modal onClose={() => setShowRotateRangeModal(false)}>
          <h3>Rotate Page Range</h3>
          <p className="modal-help">Rotate every page in the range 90° clockwise or counter-clockwise.</p>
          <PageRangePairInputs
            startPage={rotateRange.startPage}
            endPage={rotateRange.endPage}
            onStartChange={rotateRange.setStartPage}
            onEndChange={rotateRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <div className="modal-actions">
            <button onClick={() => setShowRotateRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleRotatePageRange(false)} className="btn">Rotate CW</button>
            <button onClick={() => void handleRotatePageRange(true)} className="btn">Rotate CCW</button>
            <button onClick={() => void handleRotatePage180Range()} className="btn">Rotate 180°</button>
            <button onClick={() => void handleResetRotationRange()} className="btn">Reset Rot.</button>
          </div>
        </Modal>
      )}

      {/* Keep Range Modal */}
      {showKeepRangeModal && (
        <Modal onClose={() => setShowKeepRangeModal(false)}>
          <h3>Keep Page Range</h3>
          <p className="modal-help">Delete every page outside the selected range.</p>
          <PageRangePairInputs
            startPage={keepRange.startPage}
            endPage={keepRange.endPage}
            onStartChange={keepRange.setStartPage}
            onEndChange={keepRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <div className="modal-actions">
            <button onClick={() => setShowKeepRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleKeepPageRange()} className="btn btn-danger">Keep range</button>
          </div>
        </Modal>
      )}

      {/* Move Range Modal */}
      {showMoveRangeModal && (
        <Modal onClose={() => setShowMoveRangeModal(false)}>
          <h3>Move Page Range</h3>
          <p className="modal-help">Move a contiguous block so its first page lands at the target index (0 = first).</p>
          <PageRangePairInputs
            startPage={moveRange.startPage}
            endPage={moveRange.endPage}
            onStartChange={moveRange.setStartPage}
            onEndChange={moveRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <label>Target index (1-{((pageCount ?? 0) + 1)}): <input type="number" value={moveRangeToIndex + 1} onChange={(e) => setMoveRangeToIndex(Math.max(0, parseInt(e.target.value, 10) - 1))} min="1" max={(pageCount ?? 0) + 1} className="modal-input" /></label>
          <div className="modal-actions">
            <button onClick={() => setShowMoveRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleMovePageRangeToStart()} className="btn">To Start</button>
            <button onClick={() => void handleMovePageRangeToEnd()} className="btn">To End</button>
            <button onClick={() => void handleMovePageRange()} className="btn">Move</button>
          </div>
        </Modal>
      )}

      {/* Prepend Modal */}
      {showPrependModal && (
        <Modal onClose={() => setShowPrependModal(false)}>
          <h3>Prepend PDF</h3>
          <p className="modal-help">Insert pages from another PDF at the beginning of the document.</p>
          <label>Source PDF path:</label>
          <div className="modal-path-row">
            <input type="text" value={prependFilePath} onChange={(e) => void handlePrependSourcePathChange(e.target.value)} className="modal-input" placeholder="/path/to/source.pdf" />
            <button onClick={() => openPdfBrowser('prepend')} className="btn">Browse…</button>
          </div>
          {prependSourcePageCount !== null && (
            <>
              <PageRangePairInputs
                startPage={prependRange.startPage}
                endPage={prependRange.endPage}
                onStartChange={prependRange.setStartPage}
                onEndChange={prependRange.setEndPage}
                maxPage={prependSourcePageCount ?? undefined}
              />
            </>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowPrependModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handlePrependPdf()} className="btn" disabled={!prependFilePath.trim()}>Prepend</button>
          </div>
        </Modal>
      )}

      {/* Split Every N Modal */}
      {showSplitEveryModal && (
        <Modal onClose={() => setShowSplitEveryModal(false)}>
          <h3>Split Every N Pages</h3>
          <p className="modal-help">Write consecutive chunk files beside the open PDF. The working copy is not modified.</p>
          <label>Pages per file:</label>
          <input type="number" value={splitEveryN} onChange={(e) => setSplitEveryN(Math.max(1, parseInt(e.target.value, 10) || 1))} min="1" className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowSplitEveryModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleSplitEveryN()} className="btn">Split</button>
          </div>
        </Modal>
      )}

      {/* Page Border Modal */}
      {showPageBorderModal && (
        <Modal onClose={() => setShowPageBorderModal(false)}>
          <h3>Page Border</h3>
          <p className="modal-help">Draw a rectangular border inset from page edges (viewer pixels).</p>
          <label>Inset (px): <input type="number" value={pageBorderInset} onChange={(e) => setPageBorderInset(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <PageRangeFields range={pageBorderRange} pageCount={pageCount} />
          <div className="modal-actions">
            <button onClick={() => setShowPageBorderModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleAddPageBorderOddPages()} className="btn">Apply Odd</button>
            <button onClick={() => void handleAddPageBorderEvenPages()} className="btn">Apply Even</button>
            <button onClick={() => void handleAddPageBorder()} className="btn">Apply</button>
          </div>
        </Modal>
      )}

      {/* Bookmark All Modal */}
      {showBookmarkAllModal && (
        <Modal onClose={() => setShowBookmarkAllModal(false)}>
          <h3>Bookmark All Pages</h3>
          <p className="modal-help">Append an outline entry for every page.</p>
          <label>Title prefix:</label>
          <input type="text" value={bookmarkAllPrefix} onChange={(e) => setBookmarkAllPrefix(e.target.value)} className="modal-input" placeholder="Page " />
          <div className="modal-actions">
            <button onClick={() => setShowBookmarkAllModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleBookmarkOddPages()} className="btn" disabled={!bookmarkAllPrefix.trim()}>Bookmark Odd</button>
            <button onClick={() => void handleBookmarkEvenPages()} className="btn" disabled={!bookmarkAllPrefix.trim()}>Bookmark Even</button>
            <button onClick={() => void handleBookmarkAllPages()} className="btn" disabled={!bookmarkAllPrefix.trim()}>Add all</button>
          </div>
        </Modal>
      )}

      {/* Shrink Margins Modal */}
      {showShrinkMarginsModal && (
        <Modal onClose={() => setShowShrinkMarginsModal(false)}>
          <h3>Shrink Margins</h3>
          <p className="modal-help">Shrink MediaBox inward (clips page edges; does not scale content).</p>
          <PageRangeFields range={shrinkMarginsRange} pageCount={pageCount} />
          <label>Top: <input type="number" value={shrinkMarginTop} onChange={(e) => setShrinkMarginTop(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Right: <input type="number" value={shrinkMarginRight} onChange={(e) => setShrinkMarginRight(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Bottom: <input type="number" value={shrinkMarginBottom} onChange={(e) => setShrinkMarginBottom(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Left: <input type="number" value={shrinkMarginLeft} onChange={(e) => setShrinkMarginLeft(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <div className="modal-actions">
            <button onClick={() => setShowShrinkMarginsModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleShrinkOddPages()} className="btn">Shrink Odd</button>
            <button onClick={() => void handleShrinkEvenPages()} className="btn">Shrink Even</button>
            <button onClick={() => void handleShrinkPageMargins()} className="btn">Shrink</button>
          </div>
        </Modal>
      )}

      {/* Split At Page Modal */}
      {showSplitAtModal && (
        <Modal onClose={() => setShowSplitAtModal(false)}>
          <h3>Split At Page</h3>
          <p className="modal-help">Write `_part1.pdf` (pages before the split) and `_part2.pdf` (from the split page onward). The open document is not modified.</p>
          <label>Start of second file (page 2–{pageCount ?? 0}):</label>
          <input type="number" value={splitAtPage} onChange={(e) => setSplitAtPage(Math.max(2, parseInt(e.target.value, 10) || 2))} min="2" max={pageCount ?? undefined} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowSplitAtModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleSplitPdfAtPage()} className="btn">Split</button>
          </div>
        </Modal>
      )}

      {/* Delete Every Nth Page Modal */}
      {showDeleteNthModal && (
        <Modal onClose={() => setShowDeleteNthModal(false)}>
          <h3>Delete Every Nth Page</h3>
          <p className="modal-help">Delete pages n, 2n, 3n, … (1-based). At least one page is always kept.</p>
          <label>N (≥ 2):</label>
          <input type="number" value={deleteNthValue} onChange={(e) => setDeleteNthValue(Math.max(2, parseInt(e.target.value, 10) || 2))} min="2" className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowDeleteNthModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleDeleteEveryNthPage()} className="btn btn-danger">Delete</button>
          </div>
        </Modal>
      )}

      {/* Extract Odd Pages Modal */}
      {showExtractOddModal && (
        <Modal onClose={() => setShowExtractOddModal(false)}>
          <h3>Extract Odd Pages</h3>
          <p className="modal-help">Save pages 1, 3, 5, … to a new PDF. The open document is not modified.</p>
          <label>Output path:</label>
          <input type="text" value={extractOddOutputPath} onChange={(e) => setExtractOddOutputPath(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowExtractOddModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleExtractOddPages()} className="btn" disabled={!extractOddOutputPath.trim()}>Extract</button>
          </div>
        </Modal>
      )}

      {/* Extract Even Pages Modal */}
      {showExtractEvenModal && (
        <Modal onClose={() => setShowExtractEvenModal(false)}>
          <h3>Extract Even Pages</h3>
          <p className="modal-help">Save pages 2, 4, 6, … to a new PDF. The open document is not modified.</p>
          <label>Output path:</label>
          <input type="text" value={extractEvenOutputPath} onChange={(e) => setExtractEvenOutputPath(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowExtractEvenModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleExtractEvenPages()} className="btn" disabled={!extractEvenOutputPath.trim()}>Extract</button>
          </div>
        </Modal>
      )}

      {/* Expand Margins Modal */}
      {showExpandMarginsModal && (
        <Modal onClose={() => setShowExpandMarginsModal(false)}>
          <h3>Expand Margins</h3>
          <p className="modal-help">Grow MediaBox outward (adds white space; does not scale content).</p>
          <PageRangeFields range={expandMarginsRange} pageCount={pageCount} />
          <label>Top: <input type="number" value={expandMarginTop} onChange={(e) => setExpandMarginTop(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Right: <input type="number" value={expandMarginRight} onChange={(e) => setExpandMarginRight(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Bottom: <input type="number" value={expandMarginBottom} onChange={(e) => setExpandMarginBottom(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Left: <input type="number" value={expandMarginLeft} onChange={(e) => setExpandMarginLeft(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <div className="modal-actions">
            <button onClick={() => setShowExpandMarginsModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleExpandOddPages()} className="btn">Expand Odd</button>
            <button onClick={() => void handleExpandEvenPages()} className="btn">Expand Even</button>
            <button onClick={() => void handleExpandPageMargins()} className="btn">Expand</button>
          </div>
        </Modal>
      )}

      {/* Reverse Range Modal */}
      {showReverseRangeModal && (
        <Modal onClose={() => setShowReverseRangeModal(false)}>
          <h3>Reverse Page Range</h3>
          <p className="modal-help">Reverse order within the selected page range only.</p>
          <PageRangePairInputs
            startPage={reverseRange.startPage}
            endPage={reverseRange.endPage}
            onStartChange={reverseRange.setStartPage}
            onEndChange={reverseRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <div className="modal-actions">
            <button onClick={() => setShowReverseRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleReversePageRange()} className="btn">Reverse</button>
          </div>
        </Modal>
      )}

      {/* Insert Blank Pages Modal */}
      {showInsertBlankPagesModal && (
        <Modal onClose={() => setShowInsertBlankPagesModal(false)}>
          <h3>Insert Blank Pages</h3>
          <p className="modal-help">Insert multiple empty pages at once.</p>
          <label>Insert at position (1-{((pageCount ?? 0) + 1)}):</label>
          <input type="number" value={insertBlankAtIndex + 1} onChange={(e) => setInsertBlankAtIndex(Math.max(0, parseInt(e.target.value, 10) - 1))} min="1" max={(pageCount ?? 0) + 1} className="modal-input" />
          <label>Number of pages:</label>
          <input type="number" value={insertBlankCount} onChange={(e) => setInsertBlankCount(Math.max(1, parseInt(e.target.value, 10) || 1))} min="1" className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowInsertBlankPagesModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleInsertBlankPages()} className="btn">Insert</button>
          </div>
        </Modal>
      )}

      {/* Parity Range Modal */}
      {showParityRangeModal && (
        <Modal onClose={() => setShowParityRangeModal(false)}>
          <h3>Parity Range Tools</h3>
          <p className="modal-help">Run parity actions within a page range, or document-wide mod-3/mod-4 filters (no range). Export/extract use the output path below; margin/text stamps use values from their respective modals.</p>
          {parityBatchNeedsRange(parityRangeCommand) && (
            <>
              <PageRangePairInputs
                startPage={parityRange.startPage}
                endPage={parityRange.endPage}
                onStartChange={parityRange.setStartPage}
                onEndChange={parityRange.setEndPage}
                maxPage={pageCount ?? undefined}
              />
            </>
          )}
          <label>Action:</label>
          <select className="modal-input" value={parityRangeCommand} onChange={(e) => setParityRangeCommand(e.target.value)}>
            {(parityBatchCommands as string[]).map((cmd) => (
              <option key={cmd} value={cmd}>{cmd.replaceAll('_', ' ')}</option>
            ))}
          </select>
          {(parityRangeCommand.startsWith('export_') || parityRangeCommand.startsWith('extract_')) && (
            <>
              <label>{parityRangeCommand.startsWith('extract_') ? 'Output PDF path:' : 'Output directory:'}</label>
              <input type="text" value={parityRangeOutputPath} onChange={(e) => setParityRangeOutputPath(e.target.value)} className="modal-input" placeholder={parityRangeCommand.startsWith('extract_') ? '/path/to/output.pdf' : '/path/to/output_dir'} />
            </>
          )}
          <div className="modal-actions">
            <button onClick={() => setShowParityRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleParityRangeAction()} className="btn">Run</button>
          </div>
        </Modal>
      )}

      {/* Crop Range Modal */}
      {showCropRangeModal && (
        <Modal onClose={() => setShowCropRangeModal(false)}>
          <h3>Crop Page Range</h3>
          <p className="modal-help">Apply the same margins to every page in the range.</p>
          <PageRangePairInputs
            startPage={cropRange.startPage}
            endPage={cropRange.endPage}
            onStartChange={cropRange.setStartPage}
            onEndChange={cropRange.setEndPage}
            maxPage={pageCount ?? undefined}
          />
          <label>Top: <input type="number" value={cropMarginTop} onChange={(e) => setCropMarginTop(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Right: <input type="number" value={cropMarginRight} onChange={(e) => setCropMarginRight(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Bottom: <input type="number" value={cropMarginBottom} onChange={(e) => setCropMarginBottom(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <label>Left: <input type="number" value={cropMarginLeft} onChange={(e) => setCropMarginLeft(Math.max(0, parseInt(e.target.value, 10) || 0))} min="0" className="modal-input" /></label>
          <div className="modal-actions">
            <button onClick={() => setShowCropRangeModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleCropOddPages()} className="btn">Crop Odd</button>
            <button onClick={() => void handleCropEvenPages()} className="btn">Crop Even</button>
            <button onClick={() => void handleCropPageRange()} className="btn">Crop</button>
          </div>
        </Modal>
      )}

      {/* Decrypt Modal */}
      {showDecryptModal && (
        <Modal onClose={() => setShowDecryptModal(false)}>
          <h3>Decrypt PDF</h3>
          <p className="modal-help">Writes an unencrypted copy as <code>&lt;name&gt;_decrypted.pdf</code> beside the encrypted source (uses the original file path when available).</p>
          <label>Password:</label>
          <input type="password" value={decryptPassword} onChange={(e) => setDecryptPassword(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowDecryptModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleRemovePdfPassword()} className="btn" disabled={!decryptPassword}>Decrypt</button>
          </div>
        </Modal>
      )}

      {/* Insert Image Page Modal */}
      {showInsertImagePageModal && (
        <Modal onClose={() => setShowInsertImagePageModal(false)}>
          <h3>Insert Image Page</h3>
          <p className="modal-help">Add a new page with a centered image (JPEG/PNG/WebP).</p>
          <label>Insert at position (1-{((pageCount ?? 0) + 1)}):</label>
          <input type="number" value={insertImageAtIndex + 1} onChange={(e) => setInsertImageAtIndex(Math.max(0, parseInt(e.target.value, 10) - 1))} min="1" max={(pageCount ?? 0) + 1} className="modal-input" />
          <label>Image file path:</label>
          <input type="text" value={insertImagePagePath} onChange={(e) => setInsertImagePagePath(e.target.value)} className="modal-input" placeholder="/path/to/image.jpg" />
          <div className="modal-actions">
            <button onClick={() => setShowInsertImagePageModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleInsertImagePage()} className="btn" disabled={!insertImagePagePath.trim()}>Insert</button>
          </div>
        </Modal>
      )}

      {/* Export Page PDF Modal */}
      {showExportPagePdfModal && (
        <Modal onClose={() => setShowExportPagePdfModal(false)}>
          <h3>Export Page {currentPage + 1} as PDF</h3>
          <p className="modal-help">Save only the current page to a new PDF. The open document is not modified.</p>
          <label>Output PDF path:</label>
          <input type="text" value={exportPagePdfPath} onChange={(e) => setExportPagePdfPath(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowExportPagePdfModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleExportPagePdf()} className="btn" disabled={!exportPagePdfPath.trim()}>Export</button>
          </div>
        </Modal>
      )}

      {/* Rename Bookmark Modal */}
      {showRenameBookmarkModal && (
        <Modal onClose={() => setShowRenameBookmarkModal(false)}>
          <h3>Rename Bookmark</h3>
          <label>Title:</label>
          <input type="text" value={renameBookmarkTitle} onChange={(e) => setRenameBookmarkTitle(e.target.value)} className="modal-input" />
          <div className="modal-actions">
            <button onClick={() => setShowRenameBookmarkModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleRenameBookmark()} className="btn" disabled={!renameBookmarkTitle.trim()}>Rename</button>
          </div>
        </Modal>
      )}

      {/* Extract Modal */}
      {showExtractModal && (
        <Modal onClose={() => setShowExtractModal(false)}>
          <h3>Extract Pages</h3>
          <p className="modal-help">Save a page range from this document into a new PDF. The open file is not modified.</p>
          <PageRangePairInputs
            startPage={extractRange.startPage}
            endPage={extractRange.endPage}
            onStartChange={(start) => {
              extractRange.setStartPage(start);
              setExtractOutputPath(defaultExtractOutputPath(start, extractRange.endPage));
            }}
            onEndChange={(end) => {
              extractRange.setEndPage(end);
              setExtractOutputPath(defaultExtractOutputPath(extractRange.startPage, end));
            }}
            maxPage={pageCount ?? undefined}
          />
          <label>Output PDF path:</label>
          <div className="modal-path-row">
            <input
              type="text"
              value={extractOutputPath}
              onChange={(e) => setExtractOutputPath(e.target.value)}
              className="modal-input"
              placeholder="/path/to/output.pdf"
            />
            {nativeDialogs && (
              <button onClick={() => void chooseExtractOutputNative()} className="btn">Choose file…</button>
            )}
          </div>
          <div className="modal-actions">
            <button onClick={() => setShowExtractModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={() => void handleExtractPdf()} className="btn" disabled={!extractOutputPath.trim()}>Extract</button>
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
            <PageRangePairInputs
              startPage={mergeRange.startPage}
              endPage={mergeRange.endPage}
              onStartChange={mergeRange.setStartPage}
              onEndChange={mergeRange.setEndPage}
              maxPage={mergeSourcePageCount ?? undefined}
            />
          </div>
          {mergeSourcePageCount ? (
            <p className="modal-help">
              Appends page{mergeRange.startPage === mergeRange.endPage ? '' : 's'} {mergeRange.startPage + 1}
              {mergeRange.startPage === mergeRange.endPage ? '' : `–${mergeRange.endPage + 1}`} of the source ({mergeSourcePageCount} pages) after page {pageCount ?? 0} of this document.
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
            <PageRangePairInputs
              startPage={insertRange.startPage}
              endPage={insertRange.endPage}
              onStartChange={insertRange.setStartPage}
              onEndChange={insertRange.setEndPage}
              maxPage={insertSourcePageCount ?? undefined}
            />
          </div>
          {insertSourcePageCount ? (
            <p className="modal-help">
              Inserts page{insertRange.startPage === insertRange.endPage ? '' : 's'} {insertRange.startPage + 1}
              {insertRange.startPage === insertRange.endPage ? '' : `–${insertRange.endPage + 1}`} of the source ({insertSourcePageCount} pages) at position {insertAtPage + 1} of this document.
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

      {showTesseractModal && (
        <Modal onClose={closeTesseractReminderModal}>
          <h3>Read text from scanned PDFs (optional)</h3>
          <p className="modal-help">{tesseractInstallGuide.summary}</p>
          <p className="modal-help">{tesseractInstallGuide.licenseNote}</p>
          <ol className="modal-steps">
            {tesseractInstallGuide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {tesseractInstallGuide.installCommand && (
            <>
              <label htmlFor="tesseract-install-command">Install command</label>
              <div className="modal-path-row">
                <input
                  id="tesseract-install-command"
                  type="text"
                  readOnly
                  value={tesseractInstallGuide.installCommand}
                  className="modal-input"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(tesseractInstallGuide.installCommand ?? '');
                    showToast('Install command copied');
                  }}
                >
                  Copy
                </button>
              </div>
            </>
          )}
          {tesseractInstallGuide.downloadUrl && (
            <p className="modal-help">
              <a href={tesseractInstallGuide.downloadUrl} target="_blank" rel="noreferrer">
                {tesseractInstallGuide.platform === 'windows'
                  ? 'Download Tesseract for Windows'
                  : 'Tesseract project page'}
              </a>
            </p>
          )}
          <div className="modal-actions modal-actions-split">
            <label className="modal-checkbox-row">
              <input
                type="checkbox"
                checked={tesseractDoNotRemind}
                onChange={(e) => setTesseractDoNotRemind(e.target.checked)}
              />
              <span>Do not remind me again</span>
            </label>
            <button type="button" onClick={closeTesseractReminderModal} className="btn btn-active">
              Close
            </button>
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
            <button onClick={() => void handleClearPdfMetadata()} className="btn btn-secondary">Clear all</button>
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

export default App;
