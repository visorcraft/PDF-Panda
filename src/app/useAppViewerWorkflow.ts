import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo } from 'react';
import { useThumbnailReorder } from './useThumbnailReorder';
import { usePageZoom } from '../viewer/usePageZoom';
import { useWheelNavigation } from '../viewer/useWheelNavigation';
import { useContinuousScroll } from '../viewer/useContinuousScroll';
import type { PdfPageSize, ScrollViewMode, ViewMode } from './types';

type UseAppViewerWorkflowInput = {
  pageCount: number | null;
  viewMode: ViewMode;
  scrollViewMode: ScrollViewMode;
  currentPage: number;
  filePath: string;
  pdfRevision: number;
  pageSizes: PdfPageSize[];
  draggedIndex: number | null;
  zoom: number;
  zoomInput: string;
  pageInput: string;
  setDraggedIndex: (index: number | null) => void;
  setCurrentPage: (page: number) => void;
  setZoom: Dispatch<SetStateAction<number>>;
  setZoomInput: (value: string) => void;
  setPageInput: (value: string) => void;
  goToPage: (page: number) => void;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  markPdfEdited: () => void;
  loadThumbnails: (path: string) => Promise<void>;
  renderPage: (path: string, page: number) => Promise<void>;
};

export function useAppViewerWorkflow(input: UseAppViewerWorkflowInput) {
  const {
    pageCount,
    viewMode,
    scrollViewMode,
    currentPage,
    filePath,
    pdfRevision,
    pageSizes,
    draggedIndex,
    zoom,
    zoomInput,
    pageInput,
    setDraggedIndex,
    setCurrentPage,
    setZoom,
    setZoomInput,
    setPageInput,
    goToPage: goToPageSingle,
    withLoading,
    markPdfEdited,
    loadThumbnails,
    renderPage,
  } = input;

  const { scrollRef, handleWheel, handleImageLoad } = useWheelNavigation({
    pageCount,
    viewMode,
    scrollViewMode,
    currentPage,
    goToPage: goToPageSingle,
  });

  const continuousScroll = useContinuousScroll({
    filePath,
    pdfRevision,
    pageCount,
    pageSizes,
    zoom,
    scrollRef,
    setCurrentPage,
    setPageInput,
  });

  const goToPage = useCallback(
    (page: number) => {
      if (scrollViewMode === 'continuous' && viewMode === 'pdf') {
        continuousScroll.goToPageContinuous(page);
        return;
      }
      goToPageSingle(page);
    },
    [continuousScroll.goToPageContinuous, goToPageSingle, scrollViewMode, viewMode],
  );

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

  const continuous = useMemo(
    () => (scrollViewMode === 'continuous' ? continuousScroll.continuous : null),
    [continuousScroll.continuous, scrollViewMode],
  );

  return {
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
    goToPage,
    continuous,
    scrollToPageRef: continuousScroll.scrollToPageRef,
  };
}
