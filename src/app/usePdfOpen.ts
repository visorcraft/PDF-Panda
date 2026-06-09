import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import type { ViewMode } from './types';

type UsePdfOpenOptions = {
  filePath: string;
  originalPath: string;
  openFilePath: string;
  pendingEncryptedPath: string;
  pdfPasswordDraft: string;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  resetHistoryForOpen: (working: string) => Promise<void>;
  renderPage: (path: string, page: number) => Promise<void>;
  loadThumbnails: (path: string) => Promise<void>;
  loadFormFields: (path: string) => Promise<void>;
  rememberOpenedPdf: (path: string) => void;
  cancelDrawing: () => void;
  guardUnsaved: (fn: () => void) => void;
  showToast: (msg: string, kind?: 'error') => void;
  setOriginalPath: (path: string) => void;
  setFilePath: (path: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setMarkdownText: (text: string) => void;
  setMarkdownPath: (path: string) => void;
  setMarkdownOcrNotice: (notice: null) => void;
  setPdfRevision: (revision: number) => void;
  setMarkdownRevision: (revision: null) => void;
  setPageCount: (count: number) => void;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setOpenFilePath: (path: string) => void;
  setShowOpenModal: (open: boolean) => void;
  setPendingEncryptedPath: (path: string) => void;
  setPdfPasswordDraft: (password: string) => void;
  setShowPasswordModal: (open: boolean) => void;
};

export function usePdfOpen({
  filePath,
  originalPath,
  openFilePath,
  pendingEncryptedPath,
  pdfPasswordDraft,
  withLoading,
  resetHistoryForOpen,
  renderPage,
  loadThumbnails,
  loadFormFields,
  rememberOpenedPdf,
  cancelDrawing,
  guardUnsaved,
  showToast,
  setOriginalPath,
  setFilePath,
  setViewMode,
  setMarkdownText,
  setMarkdownPath,
  setMarkdownOcrNotice,
  setPdfRevision,
  setMarkdownRevision,
  setPageCount,
  setCurrentPage,
  setZoom,
  setOpenFilePath,
  setShowOpenModal,
  setPendingEncryptedPath,
  setPdfPasswordDraft,
  setShowPasswordModal,
}: UsePdfOpenOptions) {
  const loadPdfFromPath = useCallback(async (path: string, password?: string) => {
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
  }, [
    filePath,
    withLoading,
    resetHistoryForOpen,
    renderPage,
    loadThumbnails,
    loadFormFields,
    rememberOpenedPdf,
    cancelDrawing,
    setOriginalPath,
    setFilePath,
    setViewMode,
    setMarkdownText,
    setMarkdownPath,
    setMarkdownOcrNotice,
    setPdfRevision,
    setMarkdownRevision,
    setPageCount,
    setCurrentPage,
    setZoom,
    setPendingEncryptedPath,
    setPdfPasswordDraft,
    setShowPasswordModal,
  ]);

  const openPdf = useCallback(() => {
    guardUnsaved(() => {
      setOpenFilePath(originalPath);
      setShowOpenModal(true);
    });
  }, [guardUnsaved, originalPath, setOpenFilePath, setShowOpenModal]);

  const handleOpenPdfPath = useCallback(async () => {
    const path = openFilePath.trim();
    if (!path) return;
    const loaded = await loadPdfFromPath(path);
    if (loaded) setShowOpenModal(false);
  }, [openFilePath, loadPdfFromPath, setShowOpenModal]);

  const handleOpenEncryptedPdf = useCallback(async () => {
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
  }, [
    pendingEncryptedPath,
    pdfPasswordDraft,
    loadPdfFromPath,
    showToast,
    setShowPasswordModal,
    setShowOpenModal,
    setPendingEncryptedPath,
    setPdfPasswordDraft,
  ]);

  const handleOpenRecentPdf = useCallback(async (path: string) => {
    setOpenFilePath(path);
    const loaded = await loadPdfFromPath(path);
    if (loaded) setShowOpenModal(false);
  }, [loadPdfFromPath, setOpenFilePath, setShowOpenModal]);

  return {
    loadPdfFromPath,
    openPdf,
    handleOpenPdfPath,
    handleOpenEncryptedPdf,
    handleOpenRecentPdf,
  };
}
