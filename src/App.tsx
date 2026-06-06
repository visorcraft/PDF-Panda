import React, { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

function App() {
  const [filePath, setFilePath] = useState<string>('');
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [imageSrc, setImageSrc] = useState<string>('');
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Annotations
  const [highlightMode, setHighlightMode] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [highlightStart, setHighlightStart] = useState<{ x: number; y: number } | null>(null);
  const [highlightRect, setHighlightRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Modals
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitRanges, setSplitRanges] = useState<string>('');
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertFilePath, setInsertFilePath] = useState<string>('');
  const [insertAtPage, setInsertAtPage] = useState<number>(0);
  const [insertStartPage, setInsertStartPage] = useState<number>(0);
  const [insertEndPage, setInsertEndPage] = useState<number>(0);

  interface AnnotationData {
    subtype: string;
    rect: [number, number, number, number];
    color: [number, number, number] | null;
  }

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const path = (file as any).path || '';
    setFilePath(path);

    await withLoading(async () => {
      const count = await invoke<number>('get_pdf_page_count', { path });
      setPageCount(count);
      renderPage(path, 0);
      loadThumbnails(path);
    });
  };

  const loadThumbnails = async (path: string) => {
    const thumbBytesArray = await invoke<number[][]>('get_pdf_thumbnails', {
      path, width: 100, height: 141
    });
    const thumbs = thumbBytesArray.map(bytes => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      return URL.createObjectURL(blob);
    });
    setThumbnails(thumbs);
  };

  const renderPage = async (path: string, index: number) => {
    const bytes = await invoke<number[]>('render_pdf_page', {
      path, pageIndex: index, width: 800, height: 1132
    });
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    setImageSrc(URL.createObjectURL(blob));

    const annots = await invoke<AnnotationData[]>('get_annotations', {
      path, pageIndex: index
    });
    setAnnotations(annots);
  };

  const handleDragStart = (idx: number) => setDraggedIndex(idx);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = async (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== targetIdx) {
      await withLoading(async () => {
        await invoke('move_page', { path: filePath, fromIndex: draggedIndex, toIndex: targetIdx });
        await loadThumbnails(filePath);
        setDraggedIndex(null);
        renderPage(filePath, currentPage);
      });
    }
  };

  // Highlight annotation handlers
  const getImageCoords = (clientX: number, clientY: number) => {
    if (!pageRef.current || !imgRef.current) return { x: 0, y: 0 };
    const imgBounds = imgRef.current.getBoundingClientRect();
    return {
      x: clientX - imgBounds.left,
      y: clientY - imgBounds.top,
    };
  };

  const handleHighlightMouseDown = (e: React.MouseEvent) => {
    if (!highlightMode) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    setHighlightStart(coords);
    setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handleHighlightMouseMove = (e: React.MouseEvent) => {
    if (!highlightMode || !highlightStart) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    setHighlightRect({
      x: Math.min(highlightStart.x, coords.x),
      y: Math.min(highlightStart.y, coords.y),
      w: Math.abs(coords.x - highlightStart.x),
      h: Math.abs(coords.y - highlightStart.y),
    });
  };

  const handleHighlightMouseUp = async () => {
    if (!highlightMode || !highlightRect || highlightRect.w < 5 || highlightRect.h < 5) {
      setHighlightStart(null);
      setHighlightRect(null);
      return;
    }
    const x = highlightRect.x;
    const y = highlightRect.y;
    const w = highlightRect.w;
    const h = highlightRect.h;

    await withLoading(async () => {
      await invoke('add_highlight', {
        path: filePath,
        pageIndex: currentPage,
        x1: x,
        y1: y,
        x2: x + w,
        y2: y + h,
      });
      const annots = await invoke<AnnotationData[]>('get_annotations', {
        path: filePath, pageIndex: currentPage
      });
      setAnnotations(annots);
      showToast('Highlight added');
    });

    setHighlightStart(null);
    setHighlightRect(null);
  };

  const handleConvertToMarkdown = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      const markdown = await invoke<string>('convert_pdf_to_markdown', { path: filePath });
      alert(`Markdown conversion successful!\n\n${markdown.substring(0, 500)}...`);
      showToast('Markdown conversion complete');
    });
  };

  const handleSplitPdf = async () => {
    if (!filePath || !splitRanges) return;
    await withLoading(async () => {
      const ranges = splitRanges.split(',').map(r => {
        const [start, end] = r.trim().split('-').map(n => parseInt(n.trim(), 10) - 1);
        return [start, end] as [number, number];
      });
      const outputPaths = await invoke<string[]>('split_pdf', { path: filePath, page_ranges: ranges });
      showToast(`PDF split into ${outputPaths.length} file(s)`);
      setShowSplitModal(false);
      setSplitRanges('');
    });
  };

  const handleInsertPdf = async () => {
    if (!filePath || !insertFilePath) return;
    await withLoading(async () => {
      await invoke('insert_pdf', {
        path: filePath, insert_path: insertFilePath,
        at_index: insertAtPage, insert_start: insertStartPage, insert_end: insertEndPage
      });
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

  const handleInsertFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setInsertFilePath((file as any).path || '');
  };

  const handleOptimizePdf = async () => {
    if (!filePath) return;
    await withLoading(async () => {
      const result = await invoke<string>('optimize_pdf', { path: filePath });
      showToast(result);
    });
  };

  const handlePrintPdf = async () => {
    if (!filePath) return;
    await invoke('print_pdf', { path: filePath }).catch(err => showToast(String(err), 'error'));
  };

  const changePage = (dir: -1 | 1) => {
    const next = currentPage + dir;
    if (next >= 0 && next < (pageCount ?? 0)) {
      setCurrentPage(next);
      withLoading(() => renderPage(filePath, next));
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
                onClick={() => { setCurrentPage(idx); renderPage(filePath, idx); }}
                className={`thumbnail ${currentPage === idx ? 'active' : ''} ${draggedIndex === idx ? 'dragging' : ''}`}
              />
            ))}
          </div>
        ) : (
          <p className="muted">No thumbnails loaded</p>
        )}
      </aside>

      {/* Main Content */}
      <main className="main">
        <div className="toolbar">
          <input type="file" accept=".pdf" onChange={handleFileSelect} className="file-input" />
          {filePath && (
            <>
              <button onClick={handleConvertToMarkdown} className="btn">Markdown</button>
              <button onClick={() => setShowSplitModal(true)} className="btn">Split</button>
              <button onClick={() => { setShowInsertModal(true); setInsertEndPage((pageCount || 1) - 1); }} className="btn">Insert</button>
              <button onClick={handleOptimizePdf} className="btn">Optimize</button>
              <button onClick={handlePrintPdf} className="btn">Print</button>
              <button
                onClick={() => setHighlightMode(!highlightMode)}
                className={`btn ${highlightMode ? 'btn-active' : ''}`}
              >
                {highlightMode ? 'Highlight: ON' : 'Highlight'}
              </button>
            </>
          )}
        </div>

        {pageCount && (
          <div className="page-controls">
            <button onClick={() => changePage(-1)} disabled={currentPage === 0} className="btn">Prev</button>
            <span>{currentPage + 1} / {pageCount}</span>
            <button onClick={() => changePage(1)} disabled={currentPage === (pageCount - 1)} className="btn">Next</button>
          </div>
        )}

        <div
          ref={pageRef}
          className={`page-container ${highlightMode ? 'highlight-cursor' : ''}`}
          onMouseDown={handleHighlightMouseDown}
          onMouseMove={handleHighlightMouseMove}
          onMouseUp={handleHighlightMouseUp}
        >
          {imageSrc ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img ref={imgRef} src={imageSrc} alt="PDF Page" className="page-image" />
              {/* Existing highlights */}
              {annotations.filter(a => a.subtype === 'Highlight').map((a, i) => (
                <div
                  key={i}
                  className="highlight-overlay"
                  style={{
                    left: a.rect[0],
                    top: a.rect[1],
                    width: a.rect[2] - a.rect[0],
                    height: a.rect[3] - a.rect[1],
                    backgroundColor: a.color
                      ? `rgba(${a.color[0] * 255},${a.color[1] * 255},${a.color[2] * 255},0.3)`
                      : 'rgba(255,255,0,0.3)',
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
          ) : (
            <p className="muted">No page rendered</p>
          )}
        </div>
      </main>

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
          <label>Select PDF to insert:</label>
          <input type="file" accept=".pdf" onChange={handleInsertFileSelect} />
          {insertFilePath && <p className="muted">{insertFilePath}</p>}
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
            <button onClick={handleInsertPdf} className="btn">Insert</button>
          </div>
        </Modal>
      )}
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
