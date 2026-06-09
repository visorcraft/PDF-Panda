import { useRef, useState } from 'react';
import type { MarkdownOcrNotice, ViewMode } from './types';

export function useAppDocumentState() {
  const [filePath, setFilePath] = useState<string>('');
  const [originalPath, setOriginalPath] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const isDirtyRef = useRef(false);
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
  const [pageInput, setPageInput] = useState('1');
  const [zoomInput, setZoomInput] = useState('100');

  return {
    filePath, setFilePath,
    originalPath, setOriginalPath,
    isDirty, setIsDirty,
    isDirtyRef,
    pageCount, setPageCount,
    currentPage, setCurrentPage,
    draggedIndex, setDraggedIndex,
    loading, setLoading,
    zoom, setZoom,
    toast, setToast,
    viewMode, setViewMode,
    markdownText, setMarkdownText,
    markdownPath, setMarkdownPath,
    pdfRevision, setPdfRevision,
    markdownRevision, setMarkdownRevision,
    markdownOcrNotice, setMarkdownOcrNotice,
    ocrAvailable, setOcrAvailable,
    pageInput, setPageInput,
    zoomInput, setZoomInput,
  };
}
