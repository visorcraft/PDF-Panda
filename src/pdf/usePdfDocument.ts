import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Base resolution each page is rendered at. Zoom is applied as a CSS transform
// on top of this so the rendered image and the annotation overlays scale
// together and stay aligned at any zoom level.
export const PDF_BASE_WIDTH = 800;
export const PDF_BASE_HEIGHT = 1132;

export interface PdfAnnotation {
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

type ViewMode = 'pdf' | 'markdown';

export type UsePdfDocumentDeps = {
  filePath: string;
  pageCount: number | null;
  currentPage: number;
  viewMode: ViewMode;
  setPageCount: React.Dispatch<React.SetStateAction<number | null>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setPageInput: React.Dispatch<React.SetStateAction<string>>;
  setViewMode: (mode: ViewMode) => void;
  setPdfRevision: React.Dispatch<React.SetStateAction<number>>;
  setMarkdownRevision: React.Dispatch<React.SetStateAction<number | null>>;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  loadPageEdits: (path: string, page: number) => Promise<void>;
  loadPdfBookmarks?: (path: string) => void;
  loadPageSizes?: (path: string) => void;
  cancelDrawing: () => void;
};

export function usePdfDocument({
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
  loadPdfBookmarks,
  loadPageSizes,
  cancelDrawing,
}: UsePdfDocumentDeps) {
  const [imageSrc, setImageSrc] = useState('');
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);

  const revokeViewerAssets = useCallback(() => {
    setImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setThumbnails((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    setAnnotations([]);
  }, []);

  const loadThumbnails = useCallback(async (path: string) => {
    const thumbBytesArray = await invoke<number[][]>('get_pdf_thumbnails', {
      path,
      width: 100,
      height: 141,
    });
    const thumbs = thumbBytesArray.map((bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      return URL.createObjectURL(blob);
    });
    setThumbnails((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return thumbs;
    });
  }, []);

  const renderPage = useCallback(async (path: string, index: number) => {
    const bytes = await invoke<number[]>('render_pdf_page', {
      path,
      pageIndex: index,
      width: PDF_BASE_WIDTH,
      height: PDF_BASE_HEIGHT,
    });
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    setImageSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });

    const annots = await invoke<PdfAnnotation[]>('get_annotations', { path, pageIndex: index });
    setAnnotations(annots);
    await loadPageEdits(path, index);
  }, [loadPageEdits]);

  const goToPage = useCallback((index: number) => {
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
  }, [filePath, pageCount, renderPage, setCurrentPage, setViewMode, viewMode, withLoading]);

  const reloadOpenPdf = useCallback(async (nextPage = currentPage) => {
    if (!filePath) return;
    const count = await invoke<number>('get_pdf_page_count', { path: filePath });
    const page = Math.max(0, Math.min(nextPage, count - 1));
    setPageCount(count);
    setCurrentPage(page);
    setPageInput(String(page + 1));
    setViewMode('pdf');
    await renderPage(filePath, page);
    await loadThumbnails(filePath);
    loadPdfBookmarks?.(filePath);
    loadPageSizes?.(filePath);
  }, [
    currentPage,
    filePath,
    loadPageSizes,
    loadPdfBookmarks,
    loadThumbnails,
    renderPage,
    setCurrentPage,
    setPageCount,
    setPageInput,
    setViewMode,
  ]);

  const refreshAfterWorkingChange = useCallback(async () => {
    if (!filePath) return;
    const count = await invoke<number>('get_pdf_page_count', { path: filePath });
    setPageCount(count);
    const page = Math.max(0, Math.min(currentPage, count - 1));
    setCurrentPage(page);
    setViewMode('pdf');
    setMarkdownRevision(null);
    setPdfRevision((r) => r + 1);
    cancelDrawing();
    await renderPage(filePath, page);
    await loadThumbnails(filePath);
  }, [
    cancelDrawing,
    currentPage,
    filePath,
    loadThumbnails,
    renderPage,
    setCurrentPage,
    setMarkdownRevision,
    setPageCount,
    setPdfRevision,
    setViewMode,
  ]);

  return {
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
  };
}
