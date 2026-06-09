import { useEffect, type MutableRefObject } from 'react';
import type { ViewMode } from './types';

export type AppKeyboardActions = {
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasOpenPdf: boolean;
  noteMode: boolean;
  drawMode: boolean;
  shapeMode: boolean;
  stampMode: boolean;
  redactMode: boolean;
  imageInsertMode: boolean;
  textEditMode: boolean;
  vectorEditMode: boolean;
  formAddMode: boolean;
  highlightMode: boolean;
  anyModalOpen: boolean;
  pageCount: number | null;
  currentPage: number;
  viewMode: ViewMode;
  openPdf: () => void;
  openCommandPalette: () => void;
  dismissModals: () => void;
  exitNoteMode: () => void;
  exitDrawMode: () => void;
  exitShapeMode: () => void;
  exitStampMode: () => void;
  exitRedactMode: () => void;
  exitImageInsertMode: () => void;
  exitTextEditMode: () => void;
  exitVectorEditMode: () => void;
  exitFormAddMode: () => void;
  exitHighlightMode: () => void;
  goToPage: (page: number) => void;
  toggleHighlightMode: () => void;
  toggleNoteMode: () => void;
  toggleDrawMode: () => void;
  toggleShapeMode: () => void;
  toggleStampMode: () => void;
  toggleRedactMode: () => void;
  toggleTextEditMode: () => void;
  toggleVectorEditMode: () => void;
  toggleImageInsertMode: () => void;
  toggleFormsPanel: () => void;
  openDeleteModal: () => void;
  openSaveAs: () => void;
  handleSave: () => void | Promise<void>;
  requestClosePdf: () => void;
  handlePrint: () => void | Promise<void>;
  handleRotatePage: () => void | Promise<void>;
  openSearchModal: () => void;
  handleDuplicatePage: () => void | Promise<void>;
  toggleMarkdownView: () => void | Promise<void>;
  handleOptimizePdf: () => void | Promise<void>;
  handleSummarizePdf: () => void | Promise<void>;
  openSignModal: () => void;
  openInsertModal: () => void;
  openSplitModal: () => void;
  openExtractModal: () => void;
  openExportPngModal: () => void;
  handleAddBlankPage: () => void | Promise<void>;
  handleReversePages: () => void | Promise<void>;
  openMergeModal: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useAppKeyboard(actionsRef: MutableRefObject<AppKeyboardActions>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;
      const a = actionsRef.current;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        a.openPdf();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        a.openCommandPalette();
        return;
      }

      if (e.key === 'Escape') {
        if (a.noteMode && a.hasOpenPdf) { a.exitNoteMode(); return; }
        if (a.drawMode && a.hasOpenPdf) { a.exitDrawMode(); return; }
        if (a.shapeMode && a.hasOpenPdf) { a.exitShapeMode(); return; }
        if (a.stampMode && a.hasOpenPdf) { a.exitStampMode(); return; }
        if (a.redactMode && a.hasOpenPdf) { a.exitRedactMode(); return; }
        if (a.imageInsertMode && a.hasOpenPdf) { a.exitImageInsertMode(); return; }
        if (a.textEditMode && a.hasOpenPdf) { a.exitTextEditMode(); return; }
        if (a.vectorEditMode && a.hasOpenPdf) { a.exitVectorEditMode(); return; }
        if (a.formAddMode && a.hasOpenPdf) { a.exitFormAddMode(); return; }
        if (a.highlightMode && a.hasOpenPdf) { a.exitHighlightMode(); return; }
        if (a.anyModalOpen) { a.dismissModals(); return; }
      }

      if (!a.hasOpenPdf) return;

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const count = a.pageCount;
        const page = a.currentPage;
        if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && page > 0) {
          e.preventDefault();
          a.goToPage(page - 1);
          return;
        }
        if ((e.key === 'ArrowRight' || e.key === 'PageDown') && count !== null && page < count - 1) {
          e.preventDefault();
          a.goToPage(page + 1);
          return;
        }
        if (e.key.toLowerCase() === 'h' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleHighlightMode();
          return;
        }
        if (e.key.toLowerCase() === 'n' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleNoteMode();
          return;
        }
        if (e.key.toLowerCase() === 'd' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleDrawMode();
          return;
        }
        if (e.key.toLowerCase() === 's' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleShapeMode();
          return;
        }
        if (e.key.toLowerCase() === 't' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleStampMode();
          return;
        }
        if (e.key.toLowerCase() === 'x' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleRedactMode();
          return;
        }
        if (e.key.toLowerCase() === 'e' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleTextEditMode();
          return;
        }
        if (e.key.toLowerCase() === 'g' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleVectorEditMode();
          return;
        }
        if (e.key.toLowerCase() === 'i' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleImageInsertMode();
          return;
        }
        if (e.key.toLowerCase() === 'f' && a.viewMode === 'pdf') {
          e.preventDefault();
          a.toggleFormsPanel();
          return;
        }
        if (e.key === 'Home' && page > 0) {
          e.preventDefault();
          a.goToPage(0);
          return;
        }
        if (e.key === 'End' && count !== null && page < count - 1) {
          e.preventDefault();
          a.goToPage(count - 1);
          return;
        }
        if (e.key === 'Delete' && count !== null && count > 1) {
          e.preventDefault();
          a.openDeleteModal();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey) return;

      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) a.openSaveAs();
        else if (a.isDirty) void a.handleSave();
        return;
      }
      if (key === 'w') { e.preventDefault(); a.requestClosePdf(); return; }
      if (key === 'p') { e.preventDefault(); void a.handlePrint(); return; }
      if (key === 'r') { e.preventDefault(); void a.handleRotatePage(); return; }
      if (key === 'f') { e.preventDefault(); a.openSearchModal(); return; }
      if (key === 'd' && e.shiftKey) { e.preventDefault(); void a.handleDuplicatePage(); return; }
      if (key === 'm' && e.shiftKey) { e.preventDefault(); void a.toggleMarkdownView(); return; }
      if (key === 'o' && e.shiftKey) { e.preventDefault(); void a.handleOptimizePdf(); return; }
      if (key === 'e' && e.shiftKey) { e.preventDefault(); void a.handleSummarizePdf(); return; }
      if (key === 'u' && e.shiftKey) { e.preventDefault(); a.openSignModal(); return; }
      if (key === 'i' && e.shiftKey) { e.preventDefault(); a.openInsertModal(); return; }
      if (key === 'k' && e.shiftKey) { e.preventDefault(); a.openSplitModal(); return; }
      if (key === 'j' && e.shiftKey) { e.preventDefault(); a.openExtractModal(); return; }
      if (key === 'b' && e.shiftKey) { e.preventDefault(); a.openExportPngModal(); return; }
      if (key === 'n' && e.shiftKey) { e.preventDefault(); void a.handleAddBlankPage(); return; }
      if (key === 'y' && e.shiftKey) { e.preventDefault(); void a.handleReversePages(); return; }
      if (key === 'g' && e.shiftKey) { e.preventDefault(); a.openMergeModal(); return; }
      if (key === '=' || key === '+') { e.preventDefault(); a.zoomIn(); return; }
      if (key === '-') { e.preventDefault(); a.zoomOut(); return; }
      if (key === '0') { e.preventDefault(); a.resetZoom(); return; }
      if (key === 'z' && !e.shiftKey && a.canUndo) {
        e.preventDefault();
        void a.undo();
        return;
      }
      if (a.canRedo && ((key === 'y' && !e.shiftKey) || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        void a.redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionsRef]);
}
