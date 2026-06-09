import type { Dispatch, SetStateAction } from 'react';
import { useThumbnailReorder } from './useThumbnailReorder';
import { usePageZoom } from '../viewer/usePageZoom';
import { useWheelNavigation } from '../viewer/useWheelNavigation';
import type { ViewMode } from './types';

type UseAppViewerWorkflowInput = {
  pageCount: number | null;
  viewMode: ViewMode;
  currentPage: number;
  filePath: string;
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
    currentPage,
    filePath,
    draggedIndex,
    zoom,
    zoomInput,
    pageInput,
    setDraggedIndex,
    setCurrentPage,
    setZoom,
    setZoomInput,
    setPageInput,
    goToPage,
    withLoading,
    markPdfEdited,
    loadThumbnails,
    renderPage,
  } = input;

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
  };
}
