import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PDF_BASE_HEIGHT, PDF_BASE_WIDTH } from './usePdfDocument';

const CACHE_LIMIT = 20;

type CacheEntry = {
  url: string;
  revision: number;
};

export function usePageRenderQueue(filePath: string, pdfRevision: number) {
  const cacheRef = useRef(new Map<number, CacheEntry>());
  const inflightRef = useRef(new Set<number>());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [, bump] = useState(0);

  const revokeAll = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      URL.revokeObjectURL(entry.url);
    }
    cacheRef.current.clear();
    inflightRef.current.clear();
    queueRef.current = Promise.resolve();
    bump((n) => n + 1);
  }, []);

  useEffect(() => {
    revokeAll();
  }, [filePath, pdfRevision, revokeAll]);

  const evictIfNeeded = useCallback(() => {
    while (cacheRef.current.size > CACHE_LIMIT) {
      const oldest = cacheRef.current.keys().next().value;
      if (oldest === undefined) break;
      const entry = cacheRef.current.get(oldest);
      if (entry) URL.revokeObjectURL(entry.url);
      cacheRef.current.delete(oldest);
    }
  }, []);

  const requestPage = useCallback(
    (page: number) => {
      if (!filePath || page < 0) return;
      const existing = cacheRef.current.get(page);
      if (existing && existing.revision === pdfRevision) return;
      if (inflightRef.current.has(page)) return;

      inflightRef.current.add(page);
      const revisionAtStart = pdfRevision;
      const pathAtStart = filePath;

      queueRef.current = queueRef.current
        .then(async () => {
          try {
            if (pathAtStart !== filePath || revisionAtStart !== pdfRevision) return;
            const bytes = await invoke<number[]>('render_pdf_page', {
              path: pathAtStart,
              pageIndex: page,
              width: PDF_BASE_WIDTH,
              height: PDF_BASE_HEIGHT,
            });
            if (pathAtStart !== filePath || revisionAtStart !== pdfRevision) return;
            const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const prev = cacheRef.current.get(page);
            if (prev) URL.revokeObjectURL(prev.url);
            cacheRef.current.set(page, { url, revision: revisionAtStart });
            evictIfNeeded();
            bump((n) => n + 1);
          } finally {
            inflightRef.current.delete(page);
          }
        })
        .catch(() => {});
    },
    [evictIfNeeded, filePath, pdfRevision],
  );

  const getPageUrl = useCallback(
    (page: number): string | null => {
      const entry = cacheRef.current.get(page);
      if (!entry || entry.revision !== pdfRevision) return null;
      return entry.url;
    },
    [pdfRevision],
  );

  return { requestPage, getPageUrl, revokeAll };
}
