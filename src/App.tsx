import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

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

interface AnnotationData {
  subtype: string;
  rect: [number, number, number, number];
  color: [number, number, number] | null;
}

type ViewMode = 'pdf' | 'markdown';

interface MarkdownSaveResult {
  markdown: string;
  markdownPath: string;
  written: boolean;
  conflict: boolean;
}

type PdfBrowserTarget = 'open' | 'insert';

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
  const [markdownSaveAsPath, setMarkdownSaveAsPath] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<string[]>([]); // snapshot paths; historyRef[histIdx] == current working state
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
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [highlightStart, setHighlightStart] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

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

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  const refreshUndoRedoState = useCallback(() => {
    setCanUndo(histIdxRef.current > 0);
    setCanRedo(histIdxRef.current < historyRef.current.length - 1);
    setIsDirty(histIdxRef.current !== savedIdxRef.current);
  }, []);

  const pruneUndoHistory = useCallback(() => {
    while (historyRef.current.length > MAX_UNDO_HISTORY) {
      const dropAt = savedIdxRef.current === 0 ? 1 : 0;
      if (historyRef.current.length <= dropAt) break;
      const [removed] = historyRef.current.splice(dropAt, 1);
      void invoke('discard_working_copy', { working: removed }).catch(() => {});
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
      const snapshot = await invoke<string>('snapshot_pdf', { source: working });
      // Drop any redo branch we're overwriting.
      historyRef.current.slice(histIdxRef.current + 1).forEach((p) => {
        void invoke('discard_working_copy', { working: p }).catch(() => {});
      });
      historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
      historyRef.current.push(snapshot);
      histIdxRef.current = historyRef.current.length - 1;
      pruneUndoHistory();
      refreshUndoRedoState();
    } catch {
      /* history is best-effort */
    }
  }, [pruneUndoHistory, refreshUndoRedoState]);

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
    const title = name ? `${isDirty ? '• ' : ''}${name} — PDF-Panda` : 'PDF-Panda';
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

  const loadPdfFromPath = async (path: string) => {
    const loaded = await withLoading(async () => {
      const previousWorking = filePath;
      const working = await invoke<string>('open_working_copy', { original: path });
      const count = await invoke<number>('get_pdf_page_count', { path: working });
      setOriginalPath(path);
      setFilePath(working);
      setIsDirty(false);
      // Reset undo/redo history with the freshly-opened state as the baseline.
      historyRef.current.forEach((p) => void invoke('discard_working_copy', { working: p }).catch(() => {}));
      const baseline = await invoke<string>('snapshot_pdf', { source: working });
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
      : directoryFromPath(insertFilePath) || lastBrowserDir || directoryFromPath(originalPath);
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
    } else {
      setInsertFilePath(entry.path);
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

  const cancelDrawing = () => {
    setDrawing(false);
    setHighlightStart(null);
    setHighlightRect(null);
  };

  // Highlighting is a two-click gesture: click once to set the start corner,
  // move the mouse to rubber-band the selection, click again to finish.
  const handlePageClick = (e: React.MouseEvent) => {
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
    if (!highlightMode || !drawing || !highlightStart) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    setHighlightRect({
      x: Math.min(highlightStart.x, coords.x),
      y: Math.min(highlightStart.y, coords.y),
      w: Math.abs(coords.x - highlightStart.x),
      h: Math.abs(coords.y - highlightStart.y),
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

  const toggleHighlightMode = () => {
    cancelDrawing();
    setHighlightMode((m) => !m);
  };

  const exitHighlightMode = () => {
    cancelDrawing();
    setHighlightMode(false);
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

  const openSaveAs = () => { setSaveAsPath(originalPath); setShowSaveAsModal(true); };

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
      await invoke('save_working_copy', { working: historyRef.current[histIdxRef.current], target: filePath });
      await refreshAfterWorkingChange();
      refreshUndoRedoState();
    });
  };

  const redo = async () => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    await withLoading(async () => {
      histIdxRef.current += 1;
      await invoke('save_working_copy', { working: historyRef.current[histIdxRef.current], target: filePath });
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
  const exitHighlightModeRef = useRef(exitHighlightMode);
  exitHighlightModeRef.current = exitHighlightMode;
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
  const toggleMarkdownViewRef = useRef(async () => {});
  const openDeleteModalRef = useRef(openDeleteModal);
  openDeleteModalRef.current = openDeleteModal;

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

      if (!hasOpenPdfRef.current) return;

      if (e.key === 'Escape' && highlightModeRef.current) {
        exitHighlightModeRef.current();
        return;
      }

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
      if (key === 'm' && e.shiftKey) {
        e.preventDefault();
        void toggleMarkdownViewRef.current();
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
    historyRef.current.forEach((p) => void invoke('discard_working_copy', { working: p }).catch(() => {}));
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

  const openMarkdownSaveAs = () => {
    const defaultPath = markdownPath || siblingMarkdownPath(originalPath || filePath);
    setMarkdownSaveAsPath(defaultPath);
    setShowMarkdownSaveAsModal(true);
  };

  const handleMarkdownSaveAs = async () => {
    const target = markdownSaveAsPath.trim();
    if (!filePath || !target) return;
    await withLoading(async () => {
      await saveMarkdownToPath(target, viewMode === 'markdown');
      setShowMarkdownSaveAsModal(false);
    });
  };

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

  const handleOptimizePdf = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      const result = await invoke<string>('optimize_pdf', { path: filePath });
      showToast(result);
    });
  };

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
      </aside>

      {/* Main Content */}
      <main className="main">
        {/* Fixed header: toolbar + page/zoom controls stay put while the page scrolls */}
        <div className="header">
          <div className="toolbar">
            <button onClick={openPdf} className="btn btn-active" title="Open PDF (Ctrl+O)">Open PDF</button>
            {filePath && (
              <>
                <button onClick={handleSave} className="btn" disabled={!isDirty} title="Save (Ctrl+S)">{isDirty ? 'Save •' : 'Save'}</button>
                <button onClick={openSaveAs} className="btn" title="Save As… (Ctrl+Shift+S)">Save As…</button>
                <button onClick={undo} className="btn" disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
                <button onClick={redo} className="btn" disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
                <button onClick={handleRotatePage} className="btn" title="Rotate 90° (Ctrl+R)">Rotate</button>
                <button onClick={openDeleteModal} className="btn" disabled={pageCount !== null && pageCount <= 1} title="Delete page (Delete)">Delete</button>
                <button onClick={() => setShowInsertModal(true)} className="btn">Insert</button>
                <button onClick={() => setShowSplitModal(true)} className="btn">Split</button>
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
                <button onClick={handleOptimizePdf} className="btn">Optimize</button>
                <button onClick={handlePrint} className="btn" title="Print (Ctrl+P)">Print</button>
                <button
                  onClick={toggleHighlightMode}
                  className={`btn ${highlightMode ? 'btn-active' : ''}`}
                  title="Toggle highlight mode (H)"
                >
                  {highlightMode ? 'Highlight: ON' : 'Highlight'}
                </button>
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
                <span className="muted">/ {pageCount}</span>
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
              className={`page-container ${highlightMode ? 'highlight-cursor' : ''}`}
              onClick={handlePageClick}
              onMouseMove={handlePageMouseMove}
            >
              {imageSrc ? (
                <div className="page-scale" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img ref={imgRef} src={imageSrc} alt="PDF Page" className="page-image" draggable={false} onLoad={handleImageLoad} />
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
                    {/* Current highlight drag */}
                    {highlightRect && highlightRect.w > 0 && highlightRect.h > 0 && (
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
              autoFocus
            />
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
            <button onClick={handleOpenPdfPath} className="btn" disabled={!openFilePath.trim()}>Open</button>
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

      {showMarkdownSaveAsModal && (
        <Modal onClose={() => setShowMarkdownSaveAsModal(false)}>
          <h3>Save Markdown As</h3>
          <label>Save to path:</label>
          <input
            type="text"
            value={markdownSaveAsPath}
            onChange={(e) => setMarkdownSaveAsPath(e.target.value)}
            className="modal-input"
            placeholder="/path/to/output.md"
          />
          <div className="modal-actions">
            <button onClick={() => setShowMarkdownSaveAsModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleMarkdownSaveAs} className="btn" disabled={!markdownSaveAsPath.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {showSaveAsModal && (
        <Modal onClose={() => setShowSaveAsModal(false)}>
          <h3>Save As</h3>
          <label>Save to path:</label>
          <input
            type="text"
            value={saveAsPath}
            onChange={(e) => setSaveAsPath(e.target.value)}
            className="modal-input"
            placeholder="/path/to/output.pdf"
          />
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
