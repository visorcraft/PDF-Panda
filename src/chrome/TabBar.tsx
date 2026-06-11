import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocumentTabInfo } from '../app/documentSessionTypes';

type TabBarProps = {
  tabs: DocumentTabInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

const SCROLL_EDGE_EPSILON = 2;

export function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // The scroll arrows are absolute overlays (see styles.css), so they never
  // take layout space — the scroll viewport width is constant whether or not an
  // arrow is showing. That keeps these thresholds (and the scroll targets below)
  // stable, so a single click always lands exactly on the intended tab.
  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollLeft = el.scrollLeft;
    setCanScrollLeft(scrollLeft > SCROLL_EDGE_EPSILON);
    setCanScrollRight(scrollLeft + el.clientWidth < el.scrollWidth - SCROLL_EDGE_EPSILON);
  }, []);

  useLayoutEffect(() => {
    checkScroll();
  }, [canScrollLeft, canScrollRight, checkScroll, tabs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, tabs]);

  // Bring a tab fully into view. Snap to the true edge when the target is the
  // first/last tab so that arrow collapses and the tab is fully revealed.
  const scrollTabIntoView = useCallback((tab: HTMLElement) => {
    const el = scrollRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.tab-item'));
    if (items.length === 0) return;

    let target: number;
    if (tab === items[items.length - 1]) {
      target = el.scrollWidth; // clamps to max → right arrow collapses
    } else if (tab === items[0]) {
      target = 0;
    } else {
      const right = tab.offsetLeft + tab.offsetWidth;
      if (right > el.scrollLeft + el.clientWidth) target = right - el.clientWidth;
      else if (tab.offsetLeft < el.scrollLeft) target = tab.offsetLeft;
      else return; // already fully visible
    }
    el.scrollTo({ left: target, behavior: 'smooth' });
  }, []);

  // Keep the active tab fully visible whenever it changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeId) return;
    const active = el.querySelector<HTMLElement>('.tab-item.active');
    if (active) scrollTabIntoView(active);
  }, [activeId, tabs, scrollTabIntoView]);

  if (tabs.length <= 1) return null;

  const scrollToNext = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.tab-item'));
    if (items.length === 0) return;
    const visibleRight = el.scrollLeft + el.clientWidth;
    const target =
      direction === 'right'
        ? items.find((item) => item.offsetLeft + item.offsetWidth > visibleRight + 1)
        : [...items].reverse().find((item) => item.offsetLeft < el.scrollLeft - 1);
    if (target) scrollTabIntoView(target);
  };

  return (
    <div className="tab-bar" role="tablist">
      {canScrollLeft && (
        <button
          type="button"
          className="tab-scroll-btn tab-scroll-btn-left"
          aria-label="Scroll tabs left"
          onClick={() => scrollToNext('left')}
        >
          ‹
        </button>
      )}
      <div className="tab-bar-scroll" ref={scrollRef}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-testid={`doc-tab-${tab.label}`}
              data-working-path={import.meta.env.VITE_WDIO === '1' ? tab.filePath || undefined : undefined}
              className={`tab-item${active ? ' active' : ''}`}
              onClick={() => onSelect(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              {tab.dirty && <span className="tab-dirty" aria-hidden />}
              <span className="tab-label">{tab.label}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${tab.label}`}
                data-testid={`doc-tab-close-${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {canScrollRight && (
        <button
          type="button"
          className="tab-scroll-btn tab-scroll-btn-right"
          aria-label="Scroll tabs right"
          onClick={() => scrollToNext('right')}
        >
          ›
        </button>
      )}
    </div>
  );
}
