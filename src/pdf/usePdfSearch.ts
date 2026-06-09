import { invoke } from '@tauri-apps/api/core';
import { useRef, useState } from 'react';
import type { PdfTextSearchMatch } from '../modals/SearchModal';
import type { ViewMode } from '../app/types';

type UsePdfSearchOptions = {
  filePath: string;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  renderPage: (path: string, page: number) => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  setCurrentPage: (page: number) => void;
  setPageInput: (value: string) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
};

export function usePdfSearch({
  filePath,
  withLoading,
  renderPage,
  setViewMode,
  setCurrentPage,
  setPageInput,
  showToast,
}: UsePdfSearchOptions) {
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchResults, setSearchResults] = useState<PdfTextSearchMatch[]>([]);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [activeSearchRect, setActiveSearchRect] = useState<[number, number, number, number] | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  return {
    showSearchModal,
    setShowSearchModal,
    searchQuery,
    setSearchQuery,
    searchMatchCase,
    setSearchMatchCase,
    searchWholeWord,
    setSearchWholeWord,
    searchResults,
    searchResultIndex,
    activeSearchRect,
    setActiveSearchRect,
    searchInputRef,
    openSearchModal,
    closeSearchModal,
    runPdfSearch,
    stepSearchMatch,
  };
}
