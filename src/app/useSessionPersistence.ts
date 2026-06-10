import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DocumentSessionData } from './documentSessionTypes';
import type { ViewMode } from './types';

export interface PersistedSession {
  original_path: string;
  page: number;
  zoom: number;
  view_mode: string;
  scroll_view_mode: string;
}

export interface SessionState {
  version: number;
  active_index: number;
  sessions: PersistedSession[];
}

const SAVE_DEBOUNCE_MS = 200;
// Session restore is controlled by the PDF_PANDA_NO_RESTORE=1 env var on the backend.
// The frontend always attempts to save/restore; the backend silently no-ops when disabled.

function toState(sessions: DocumentSessionData[], activeId: string | null): SessionState | null {
  const withPath = sessions.filter((s) => s.originalPath);
  if (withPath.length === 0) return null;
  const activeIndex = activeId ? withPath.findIndex((s) => s.id === activeId) : 0;
  return {
    version: 1,
    active_index: Math.max(0, activeIndex),
    sessions: withPath.map((s) => ({
      original_path: s.originalPath,
      page: s.currentPage,
      zoom: s.zoom,
      view_mode: s.viewMode,
      scroll_view_mode: s.scrollViewMode,
    })),
  };
}

export function useSessionPersistence({
  sessions,
  activeId,
  updateSession,
  ensureSessionForOpen,
  loadPdfFromPath,
  showToast,
}: {
  sessions: DocumentSessionData[];
  activeId: string | null;
  updateSession: (id: string, patch: Partial<DocumentSessionData>) => void;
  ensureSessionForOpen: (originalPath: string) => string | null;
  loadPdfFromPath: (path: string) => Promise<boolean>;
  showToast: (msg: string, kind?: 'error') => void;
}) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestoringRef = useRef(false);

  const saveSessions = useCallback(async () => {
    if (isRestoringRef.current) return;
    const state = toState(sessions, activeId);
    if (!state) return;
    try {
      await invoke('save_session_state', { state });
    } catch {
      // Silent fail — session restore is best-effort.
    }
  }, [sessions, activeId]);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveSessions();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeId, saveSessions]);

  const restoreSessions = useCallback(async () => {
    try {
      const state = await invoke<SessionState | null>('load_session_state');
      if (!state || !state.sessions.length) return;
      isRestoringRef.current = true;
      const opened: { sessionId: string; page: number; zoom: number; viewMode: ViewMode; scrollViewMode: 'single' | 'continuous' }[] = [];
      for (const s of state.sessions) {
        const sessionId = ensureSessionForOpen(s.original_path);
        if (sessionId === null) {
          // Already open — update its target state for later.
          const existing = sessions.find((es) => es.originalPath === s.original_path);
          if (existing) {
            opened.push({
              sessionId: existing.id,
              page: s.page,
              zoom: s.zoom,
              viewMode: s.view_mode as ViewMode,
              scrollViewMode: s.scroll_view_mode as 'single' | 'continuous',
            });
          }
          continue;
        }
        try {
          const loaded = await loadPdfFromPath(s.original_path);
          if (loaded) {
            opened.push({
              sessionId,
              page: s.page,
              zoom: s.zoom,
              viewMode: s.view_mode as ViewMode,
              scrollViewMode: s.scroll_view_mode as 'single' | 'continuous',
            });
          }
        } catch {
          showToast(`Could not restore ${s.original_path}`, 'error');
        }
      }
      // Apply restored per-session state after all opens complete.
      for (const o of opened) {
        updateSession(o.sessionId, {
          currentPage: o.page,
          zoom: o.zoom,
          viewMode: o.viewMode,
          scrollViewMode: o.scrollViewMode,
          pageInput: String(o.page + 1),
          zoomInput: String(Math.round(o.zoom * 100)),
        });
      }
      isRestoringRef.current = false;
    } catch {
      isRestoringRef.current = false;
    }
  }, [ensureSessionForOpen, loadPdfFromPath, updateSession, showToast, sessions]);

  return { restoreSessions };
}
