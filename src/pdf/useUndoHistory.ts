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

function discardHistoryEntries(entries: HistorySnapshot[]) {
  entries.forEach((entry) => void invoke('discard_history_entry', { entry }).catch(() => {}));
}

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

  const clearHistoryState = useCallback(() => {
    historyRef.current = [];
    histIdxRef.current = 0;
    savedIdxRef.current = 0;
    deltaSnapshotNotifiedRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

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
      const redoBranch = historyRef.current.slice(histIdxRef.current + 1);
      discardHistoryEntries(redoBranch);
      historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
      historyRef.current.push(snapshot);
      histIdxRef.current = historyRef.current.length - 1;
      await pruneUndoHistory();
      refreshUndoRedoState();
    } catch (err) {
      showToast(`Undo snapshot failed: ${String(err)}`, 'error');
    }
  }, [filePathRef, pruneUndoHistory, refreshUndoRedoState, showToast]);

  const markPdfEdited = useCallback(() => {
    setPdfRevision((revision) => revision + 1);
    setViewMode('pdf');
    setIsDirty(true);
    void recordHistory();
  }, [recordHistory, setIsDirty, setPdfRevision, setViewMode]);

  const resetHistoryForOpen = useCallback(async (working: string) => {
    const oldHistory = historyRef.current;
    try {
      const baseline = await invoke<HistorySnapshot>('snapshot_pdf_entry', { history: [], source: working });
      discardHistoryEntries(oldHistory);
      historyRef.current = [baseline];
      histIdxRef.current = 0;
      savedIdxRef.current = 0;
      deltaSnapshotNotifiedRef.current = false;
      setCanUndo(false);
      setCanRedo(false);
      setIsDirty(false);
    } catch (err) {
      discardHistoryEntries(oldHistory);
      clearHistoryState();
      setIsDirty(false);
      showToast(`Undo history unavailable: ${String(err)}`, 'error');
    }
  }, [clearHistoryState, setIsDirty, showToast]);

  const markSaved = useCallback(() => {
    savedIdxRef.current = histIdxRef.current;
    refreshUndoRedoState();
  }, [refreshUndoRedoState]);

  const discardHistory = useCallback(() => {
    discardHistoryEntries(historyRef.current);
    clearHistoryState();
  }, [clearHistoryState]);

  const undo = useCallback(async (filePath: string) => {
    if (!filePath || histIdxRef.current <= 0) return;
    await withLoading(async () => {
      const prevIdx = histIdxRef.current;
      histIdxRef.current -= 1;
      try {
        await invoke('restore_history_entry', {
          history: historyRef.current,
          index: histIdxRef.current,
          target: filePath,
        });
      } catch (err) {
        histIdxRef.current = prevIdx;
        throw err;
      }
      await onRestore();
      refreshUndoRedoState();
    });
  }, [onRestore, refreshUndoRedoState, withLoading]);

  const redo = useCallback(async (filePath: string) => {
    if (!filePath || histIdxRef.current >= historyRef.current.length - 1) return;
    await withLoading(async () => {
      const prevIdx = histIdxRef.current;
      histIdxRef.current += 1;
      try {
        await invoke('restore_history_entry', {
          history: historyRef.current,
          index: histIdxRef.current,
          target: filePath,
        });
      } catch (err) {
        histIdxRef.current = prevIdx;
        throw err;
      }
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
