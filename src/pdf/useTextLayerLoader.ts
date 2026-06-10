import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export type PageTextRun = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type CacheKey = string;

function cacheKey(path: string, page: number, revision: number): CacheKey {
  return `${path}\0${page}\0${revision}`;
}

export function useTextLayerLoader(filePath: string, page: number, pdfRevision: number) {
  const [runs, setRuns] = useState<PageTextRun[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new Map<CacheKey, PageTextRun[]>());

  const load = useCallback(async () => {
    if (!filePath) {
      setRuns([]);
      return;
    }
    const key = cacheKey(filePath, page, pdfRevision);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setRuns(cached);
      return;
    }
    setLoading(true);
    try {
      const layout = await invoke<PageTextRun[]>('get_page_text_layout', {
        path: filePath,
        pageIndex: page,
      });
      cacheRef.current.set(key, layout);
      setRuns(layout);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [filePath, page, pdfRevision]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pdfRevision === 0) return;
    for (const key of [...cacheRef.current.keys()]) {
      if (key.startsWith(`${filePath}\0`) && key.endsWith(`\0${pdfRevision}`)) continue;
      if (key.startsWith(`${filePath}\0`)) cacheRef.current.delete(key);
    }
  }, [filePath, pdfRevision]);

  return { runs, loading, reload: load };
}
