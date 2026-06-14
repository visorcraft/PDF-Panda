import { useState } from 'react';
import { LAST_BROWSER_DIR_KEY, RECENT_PDFS_KEY } from './constants';
import type { PdfSummaryResult } from './types';
import { readStoredString, readStoredStringArray } from './utils';

export function useAppModalStateFile() {
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState<string>('');
  const [showMarkdownSaveAsModal, setShowMarkdownSaveAsModal] = useState(false);
  const [markdownSaveAsPath, setMarkdownSaveAsPath] = useState('');
  const [nativeDialogs, setNativeDialogs] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [pdfSummary, setPdfSummary] = useState<PdfSummaryResult | null>(null);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string>('');
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [recentPdfs, setRecentPdfs] = useState<string[]>(() => readStoredStringArray(RECENT_PDFS_KEY));
  const [lastBrowserDir, setLastBrowserDir] = useState<string>(() => readStoredString(LAST_BROWSER_DIR_KEY));

  return {
    showSaveAsModal, setShowSaveAsModal,
    saveAsPath, setSaveAsPath,
    showMarkdownSaveAsModal, setShowMarkdownSaveAsModal,
    markdownSaveAsPath, setMarkdownSaveAsPath,
    nativeDialogs, setNativeDialogs,
    showSummaryModal, setShowSummaryModal,
    pdfSummary, setPdfSummary,
    showOpenModal, setShowOpenModal,
    openFilePath, setOpenFilePath,
    showPrintDialog, setShowPrintDialog,
    recentPdfs, setRecentPdfs,
    lastBrowserDir, setLastBrowserDir,
  };
}
