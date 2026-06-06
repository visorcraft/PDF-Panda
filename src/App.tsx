import React, { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

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

function App() {
  const [filePath, setFilePath] = useState<string>('');
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
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<PdfBrowserTarget>('open');
  const [browserListing, setBrowserListing] = useState<PdfBrowserListing | null>(null);
  const [browserPathInput, setBrowserPathInput] = useState('');
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitRanges, setSplitRanges] = useState<string>('');
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertFilePath, setInsertFilePath] = useState<string>('');
  const [insertAtPage, setInsertAtPage] = useState<number>(0);
  const [insertStartPage, setInsertStartPage] = useState<number>(0);
  const [insertEndPage, setInsertEndPage] = useState<number>(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const markPdfEdited = useCallback(() => {
    setPdfRevision((revision) => revision + 1);
    setViewMode('pdf');
  }, []);

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
      const count = await invoke<number>('get_pdf_page_count', { path });
      setFilePath(path);
      setViewMode('pdf');
      setMarkdownText('');
      setMarkdownPath('');
      setPdfRevision(0);
      setMarkdownRevision(null);
      cancelDrawing();
      setPageCount(count);
      setCurrentPage(0);
      setZoom(1);
      await renderPage(path, 0);
      await loadThumbnails(path);
      return true;
    });
    return loaded === true;
  };

  const openPdf = () => {
    setOpenFilePath(filePath);
    setShowOpenModal(true);
  };

  const handleOpenPdfPath = async () => {
    const path = openFilePath.trim();
    if (!path) return;
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
    const startPath = target === 'open' ? openFilePath : insertFilePath;
    void loadPdfBrowser(startPath || filePath);
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

  const handleDeletePage = async () => {
    if (!filePath || pageCount === null) return;
    if (pageCount <= 1) {
      showToast('Cannot delete the only page', 'error');
      return;
    }
    await withLoading(async () => {
      await invoke('delete_page', { path: filePath, pageIndex: currentPage });
      markPdfEdited();
      const count = await invoke<number>('get_pdf_page_count', { path: filePath });
      setPageCount(count);
      const newPage = Math.min(currentPage, count - 1);
      setCurrentPage(newPage);
      await loadThumbnails(filePath);
      await renderPage(filePath, newPage);
      showToast('Page deleted');
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

  const handleMarkdownView = async () => {
    if (!filePath) return;
    if (markdownText && markdownRevision === pdfRevision) {
      setViewMode('markdown');
      return;
    }
    await withLoading(async () => {
      let result = await invoke<MarkdownSaveResult>('save_pdf_markdown', { path: filePath, overwrite: false });
      if (result.conflict) {
        const overwrite = window.confirm('Overwrite Markdown File?');
        if (!overwrite) return;
        result = await invoke<MarkdownSaveResult>('save_pdf_markdown', { path: filePath, overwrite: true });
      }
      setMarkdownText(result.markdown);
      setMarkdownPath(result.markdownPath);
      setMarkdownRevision(pdfRevision);
      setViewMode('markdown');
      showToast(result.written ? `Markdown saved to ${result.markdownPath}` : 'Markdown file is already up to date');
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
            <button onClick={openPdf} className="btn btn-active">Open PDF</button>
            {filePath && (
              <>
                <button onClick={handleRotatePage} className="btn">Rotate</button>
                <button onClick={handleDeletePage} className="btn">Delete</button>
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
                    onClick={handleMarkdownView}
                    className={viewMode === 'markdown' ? 'active' : ''}
                    aria-pressed={viewMode === 'markdown'}
                  >
                    Markdown
                  </button>
                </div>
                <button onClick={handleOptimizePdf} className="btn">Optimize</button>
                <button onClick={handlePrint} className="btn">Print</button>
                <button
                  onClick={toggleHighlightMode}
                  className={`btn ${highlightMode ? 'btn-active' : ''}`}
                >
                  {highlightMode ? 'Highlight: ON' : 'Highlight'}
                </button>
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
          <div className="modal-actions">
            <button onClick={() => setShowOpenModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={handleOpenPdfPath} className="btn" disabled={!openFilePath.trim()}>Open</button>
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
          <div className="insert-grid">
            <label>
              At page (1-{(pageCount ?? 0) + 1}):
              <input type="number" value={insertAtPage + 1} onChange={(e) => setInsertAtPage(Math.max(0, parseInt(e.target.value) - 1))} min="1" className="modal-input" />
            </label>
            <label>
              From (1-{pageCount ?? 0}):
              <input type="number" value={insertStartPage + 1} onChange={(e) => setInsertStartPage(Math.max(0, parseInt(e.target.value) - 1))} min="1" className="modal-input" />
            </label>
            <label>
              To (1-{pageCount ?? 0}):
              <input type="number" value={insertEndPage + 1} onChange={(e) => setInsertEndPage(Math.max(0, parseInt(e.target.value) - 1))} min="1" className="modal-input" />
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={() => { setShowInsertModal(false); setInsertFilePath(''); }} className="btn btn-secondary">Cancel</button>
            <button onClick={handleInsertPdf} className="btn" disabled={!insertFilePath}>Insert</button>
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
