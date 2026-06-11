import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DocumentTabInfo } from '../app/documentSessionTypes';

type TabBarProps = {
  tabs: DocumentTabInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

const SCROLL_EDGE_EPSILON = 2;

function scrollControlWidth(el: HTMLDivElement, side: 'left' | 'right') {
  const sibling = side === 'left' ? el.previousElementSibling : el.nextElementSibling;
  return sibling instanceof HTMLElement && sibling.classList.contains(`tab-scroll-btn-${side}`)
    ? sibling.offsetWidth
    : 0;
}

export function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const leftButtonWidth = scrollControlWidth(el, 'left');
    let scrollLeft = el.scrollLeft;
    if (
      leftButtonWidth > 0 &&
      scrollLeft > SCROLL_EDGE_EPSILON &&
      scrollLeft <= leftButtonWidth + SCROLL_EDGE_EPSILON
    ) {
      el.scrollLeft = 0;
      scrollLeft = 0;
    }

    setCanScrollLeft(scrollLeft > leftButtonWidth + SCROLL_EDGE_EPSILON);
    setCanScrollRight(
      scrollLeft + el.clientWidth <
        el.scrollWidth - scrollControlWidth(el, 'right') - SCROLL_EDGE_EPSILON,
    );
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

  if (tabs.length <= 1) return null;

  const scrollToNext = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll('.tab-item')) as HTMLElement[];
    if (items.length === 0) return;
    const scrollLeft = el.scrollLeft;
    const visibleRight = scrollLeft + el.clientWidth;

    if (direction === 'right') {
      // Find the first tab whose right edge is past the visible area
      const next = items.find((item) => item.offsetLeft + item.offsetWidth > visibleRight + 1);
      if (next) {
        el.scrollTo({ left: next.offsetLeft, behavior: 'smooth' });
      }
    } else {
      // Find the first tab whose left edge is before the visible area
      const prev = [...items].reverse().find((item) => item.offsetLeft < scrollLeft - 1);
      if (prev) {
        el.scrollTo({ left: prev.offsetLeft, behavior: 'smooth' });
      }
    }
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
