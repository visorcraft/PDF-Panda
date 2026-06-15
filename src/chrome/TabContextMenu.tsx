import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TabMenuItem } from './tabMenuModel';

type TabContextMenuProps = {
  items: TabMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
};

/** Themed, viewport-clamped popup menu. Purely presentational. */
export function TabContextMenu({ items, x, y, onClose }: TabContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<string | null>(null);

  // Dismiss on outside click, Escape, or window blur.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // Flip horizontally/vertically so the menu stays on-screen.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = x + rect.width > window.innerWidth ? Math.max(4, x - rect.width) : x;
    const top = y + rect.height > window.innerHeight ? Math.max(4, y - rect.height) : y;
    setPos({ left, top });
  }, [x, y, items]);

  const activate = (disabled: boolean | undefined, onSelect: () => void) => {
    if (disabled) return;
    onSelect();
    onClose();
  };

  return (
    <div ref={rootRef} className="tab-context-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {items.map((it, i) => {
        if (it.kind === 'divider') return <div key={`d${i}`} className="tcm-divider" />;
        if (it.kind === 'submenu') {
          return (
            <div
              key={it.id}
              className="tcm-submenu-wrap"
              onMouseEnter={() => setOpenSub(it.id)}
              onMouseLeave={() => setOpenSub((cur) => (cur === it.id ? null : cur))}
            >
              <button type="button" className="tcm-item tcm-has-sub" role="menuitem">
                <span>{it.label}</span>
                <span className="tcm-arrow" aria-hidden>
                  ›
                </span>
              </button>
              {openSub === it.id && (
                <div className="tcm-submenu" role="menu">
                  {it.items.map((sub) =>
                    sub.kind === 'item' ? (
                      <button
                        key={sub.id}
                        type="button"
                        className="tcm-item"
                        disabled={sub.disabled}
                        role="menuitem"
                        onClick={() => activate(sub.disabled, sub.onSelect)}
                      >
                        {sub.label}
                      </button>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={it.id}
            type="button"
            className="tcm-item"
            disabled={it.disabled}
            role="menuitem"
            onClick={() => activate(it.disabled, it.onSelect)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
