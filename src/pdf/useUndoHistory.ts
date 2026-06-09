import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  type HistorySnapshot,
  MAX_UNDO_HISTORY,
  SNAPSHOT_BYTE_LIMIT,
} from './historyTypes';

type ViewMode = 'pdf' | 'markdown';

export type UseUndoHistoryDeps = {
  filePathRef: React.MutableRefObject<string>;
  showToast: (message: string, type?: 'success' | 'error') => void;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  onRestore: () => Promise<void>;
  setPdfRevision: React.Dispatch<React.SetStateAction<number>>;
  setViewMode: (mode: ViewMode) => void;
  setIsDirty: (dirty: boolean) => void;
};

export function useUndoHistory({
  filePathRef,
  showToast,
  withLoading,
  onRestore,
  setPdfRevision,
  setViewMode,
  setIsDirty,
}: UseUndoHistoryDeps) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<HistorySnapshot[]>([]);
  const histIdxRef = useRef(0);
  const savedIdxRef = useRef(0);
  const deltaSnapshotNotifiedRef = useRef(false);

  const refreshUndoRedoState = useCallback(() => {
    setCanUndo(histIdxRef.current > 0);
    setCanRedo(histIdxRef.current < historyRef.current.length - 1);
    setIsDirty(histIdxRef.current !== savedIdxRef.current);
  }, [setIsDirty]);

  const pruneUndoHistory = useCallback(async () => {
    while (historyRef.current.length > MAX_UNDO_HISTORY) {
      const dropAt = savedIdxRef.current === 0 ? 1 : 0;
      if (historyRef.current.length <= dropAt) break;
      try {
        historyRef.current = await invoke<HistorySnapshot[]>('prune_history_entry', {
          history: historyRef.current,
          dropIndex: dropAt,
        });
      } catch {
        /* best-effort */
      }
      if (histIdxRef.current > dropAt) histIdxRef.current -= 1;
      else if (histIdxRef.current === dropAt) histIdxRef.current = Math.max(0, dropAt - 1);
      if (savedIdxRef.current > dropAt) savedIdxRef.current -= 1;
    }
  }, []);

  const recordHistory = useCallback(async () => {
    const working = filePathRef.current;
    if (!working) return;
    try {
      const size = await invoke<number>('file_byte_size', { path: working });
      const snapshot = await invoke<HistorySnapshot>('snapshot_pdf_entry', {
        history: historyRef.current.slice(0, histIdxRef.current + 1),
        source: working,
      });
      if (size > SNAPSHOT_BYTE_LIMIT && snapshot.kind === 'delta' && !deltaSnapshotNotifiedRef.current) {
        deltaSnapshotNotifiedRef.current = true;
        showToast('Large file: using compact undo snapshots', 'success');
      }
      historyRef.current.slice(histIdxRef.current + 1).forEach((entry) => {
        void invoke('discard_history_entry', { entry }).catch(() => {});
      });
      historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
      historyRef.current.push(snapshot);
      histIdxRef.current = historyRef.current.length - 1;
      await pruneUndoHistory();
      refreshUndoRedoState();
    } catch {
      /* history is best-effort */
    }
  }, [filePathRef, pruneUndoHistory, refreshUndoRedoState, showToast]);

  const markPdfEdited = useCallback(() => {
    setPdfRevision((revision) => revision + 1);
    setViewMode('pdf');
    setIsDirty(true);
    void recordHistory();
  }, [recordHistory, setIsDirty, setPdfRevision, setViewMode]);

  const resetHistoryForOpen = useCallback(async (working: string) => {
    historyRef.current.forEach((entry) => void invoke('discard_history_entry', { entry }).catch(() => {}));
    const baseline = await invoke<HistorySnapshot>('snapshot_pdf_entry', { history: [], source: working });
    historyRef.current = [baseline];
    histIdxRef.current = 0;
    savedIdxRef.current = 0;
    deltaSnapshotNotifiedRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
    setIsDirty(false);
  }, [setIsDirty]);

  const markSaved = useCallback(() => {
    savedIdxRef.current = histIdxRef.current;
    refreshUndoRedoState();
  }, [refreshUndoRedoState]);

  const discardHistory = useCallback(() => {
    historyRef.current.forEach((entry) => void invoke('discard_history_entry', { entry }).catch(() => {}));
    historyRef.current = [];
    histIdxRef.current = 0;
    savedIdxRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const undo = useCallback(async (filePath: string) => {
    if (histIdxRef.current <= 0) return;
    await withLoading(async () => {
      histIdxRef.current -= 1;
      await invoke('restore_history_entry', {
        history: historyRef.current,
        index: histIdxRef.current,
        target: filePath,
      });
      await onRestore();
      refreshUndoRedoState();
    });
  }, [onRestore, refreshUndoRedoState, withLoading]);

  const redo = useCallback(async (filePath: string) => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    await withLoading(async () => {
      histIdxRef.current += 1;
      await invoke('restore_history_entry', {
        history: historyRef.current,
        index: histIdxRef.current,
        target: filePath,
      });
      await onRestore();
      refreshUndoRedoState();
    });
  }, [onRestore, refreshUndoRedoState, withLoading]);

  return {
    canUndo,
    canRedo,
    markPdfEdited,
    refreshUndoRedoState,
    resetHistoryForOpen,
    markSaved,
    discardHistory,
    undo,
    redo,
  };
}
