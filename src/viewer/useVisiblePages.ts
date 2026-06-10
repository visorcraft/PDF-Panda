import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfPageSize } from '../app/types';
import { PDF_BASE_HEIGHT, PDF_BASE_WIDTH } from '../pdf/usePdfDocument';

type UseVisiblePagesOptions = {
  scrollRef: RefObject<HTMLDivElement | null>;
  pageCount: number | null;
  pageSizes: PdfPageSize[];
  zoom: number;
  onCurrentPageChange: (page: number) => void;
};

const DEFAULT_ASPECT = PDF_BASE_HEIGHT / PDF_BASE_WIDTH;

export function useVisiblePages({
  scrollRef,
  pageCount,
  pageSizes,
  zoom,
  onCurrentPageChange,
}: UseVisiblePagesOptions) {
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0]));
  const scrollToPageRef = useRef<(page: number) => void>(() => {});

  const placeholderHeight = useCallback(
    (page: number) => {
      const size = pageSizes[page];
      const aspect = size && size.width > 0 ? size.height / size.width : DEFAULT_ASPECT;
      return PDF_BASE_WIDTH * aspect * zoom + 24;
    },
    [pageSizes, zoom],
  );

  const observerRef = useRef<IntersectionObserver | null>(null);

  const registerPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
    const observer = observerRef.current;
    const prev = pageRefs.current.get(page);
    if (prev && observer) observer.unobserve(prev);
    if (el) {
      pageRefs.current.set(page, el);
      observer?.observe(el);
    } else {
      pageRefs.current.delete(page);
    }
  }, []);

  const scrollToPage = useCallback((page: number) => {
    const el = pageRefs.current.get(page);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  scrollToPageRef.current = scrollToPage;

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pageCount === null || pageCount <= 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageIndex);
            if (Number.isNaN(page)) continue;
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { root, rootMargin: '200px 0px', threshold: 0.01 },
    );
    observerRef.current = observer;
    for (const el of pageRefs.current.values()) {
      observer.observe(el);
    }

    const onScroll = () => {
      const rootRect = root.getBoundingClientRect();
      const centerY = rootRect.top + rootRect.height / 2;
      let bestPage = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const [page, el] of pageRefs.current.entries()) {
        const rect = el.getBoundingClientRect();
        const pageCenter = rect.top + rect.height / 2;
        const dist = Math.abs(pageCenter - centerY);
        if (dist < bestDist) {
          bestDist = dist;
          bestPage = page;
        }
      }
      onCurrentPageChange(bestPage);
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      observer.disconnect();
      observerRef.current = null;
      root.removeEventListener('scroll', onScroll);
    };
  }, [onCurrentPageChange, pageCount, scrollRef]);

  const pagesToRender = useCallback(
    (pages: Set<number>) => {
      const out = new Set<number>();
      for (const page of pages) {
        out.add(page);
        if (page > 0) out.add(page - 1);
        if (pageCount !== null && page < pageCount - 1) out.add(page + 1);
      }
      return out;
    },
    [pageCount],
  );

  return {
    visible,
    renderPages: pagesToRender(visible),
    placeholderHeight,
    registerPageRef,
    scrollToPage,
    scrollToPageRef,
  };
}
