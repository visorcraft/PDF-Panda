import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AboutModal } from '../about/AboutModal';
import { CreditsModal } from '../credits/CreditsModal';
import { LicensesModal } from '../licenses/LicensesModal';
import type { FlatMenuAction, MenuAction, MenuEntry, MenuRoot } from './types';
import { KEYBOARD_SHORTCUTS } from './buildAppMenus';

type MenuChromeProps = {
  menus: MenuRoot[];
  quickAccess: MenuAction[];
  allActions: FlatMenuAction[];
  showCommandPalette: boolean;
  showShortcutsHelp: boolean;
  showLicenses: boolean;
  showCredits: boolean;
  showAbout: boolean;
  onCloseCommandPalette: () => void;
  onCloseShortcutsHelp: () => void;
  onCloseLicenses: () => void;
  onCloseCredits: () => void;
  onCloseAbout: () => void;
  modeExtras?: React.ReactNode;
};

function runAction(action: MenuAction) {
  if (action.disabled) return;
  void action.run();
}

function MenuDropdownItem({
  entry,
  onClose,
}: {
  entry: MenuEntry;
  onClose: () => void;
}) {
  const [subOpen, setSubOpen] = useState(false);

  if ('separator' in entry) {
    return <div className="menu-separator" role="separator" />;
  }

  if ('items' in entry && !('id' in entry)) {
    return (
      <div
        className="menu-item menu-item-submenu"
        onMouseEnter={() => setSubOpen(true)}
        onMouseLeave={() => setSubOpen(false)}
      >
        <span className="menu-item-label">{entry.label}</span>
        <span className="menu-item-chevron">›</span>
        {subOpen && (
          <div className="menu-dropdown menu-dropdown-nested">
            {entry.items.map((child, index) => (
              <MenuDropdownItem key={`${entry.label}-${index}`} entry={child} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const action = entry as MenuAction;
  return (
    <button
      type="button"
      className={`menu-item${action.danger ? ' danger' : ''}${action.active ? ' active' : ''}`}
      disabled={action.disabled}
      data-testid={action.id === 'open' ? 'open-pdf' : action.id}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        runAction(action);
        onClose();
      }}
    >
      <span className="menu-item-label">{action.label}</span>
      {action.shortcut && <span className="menu-item-shortcut">{action.shortcut}</span>}
    </button>
  );
}

function MenuBar({ menus }: { menus: MenuRoot[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenId(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [openId]);

  return (
    <nav className="menu-bar" ref={barRef} aria-label="Application menu">
      {menus.map((menu) => (
        <div key={menu.id} className="menu-bar-entry">
          <button
            type="button"
            className={`menu-bar-trigger${openId === menu.id ? ' open' : ''}`}
            disabled={menu.disabled}
            data-testid={`menu-${menu.id}`}
            aria-haspopup="menu"
            aria-expanded={openId === menu.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenId((prev) => (prev === menu.id ? null : menu.id))}
          >
            {menu.label}
          </button>
          {openId === menu.id && !menu.disabled && (
            <div className="menu-dropdown" role="menu">
              {menu.items.map((entry, index) => (
                <MenuDropdownItem key={`${menu.id}-${index}`} entry={entry} onClose={() => setOpenId(null)} />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function QuickToolbar({ items }: { items: MenuAction[] }) {
  if (items.length === 0) return null;
  return (
    <div className="quick-toolbar" role="toolbar" aria-label="Quick access">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`btn${item.active ? ' btn-active' : ''}`}
          disabled={item.disabled}
          title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
          data-testid={
            item.id === 'qa-save'
              ? 'save-pdf'
              : item.id === 'qa-rotate'
                ? 'rotate-page'
                : item.id === 'qa-undo'
                  ? 'undo-btn'
                  : item.id === 'qa-find'
                    ? 'find-btn'
                    : undefined
          }
          onClick={() => runAction(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function CommandPalette({
  actions,
  onClose,
}: {
  actions: FlatMenuAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.filter((a) => !a.disabled).slice(0, 40);
    return actions
      .filter((a) => !a.disabled && (`${a.path} ${a.label}`.toLowerCase().includes(q)))
      .slice(0, 50);
  }, [actions, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const pick = useCallback(
    (action: FlatMenuAction) => {
      runAction(action);
      onClose();
    },
    [onClose],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === 'Enter' && filtered[highlight]) {
      event.preventDefault();
      pick(filtered[highlight]);
    }
  };

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="command-palette-list">
          {filtered.length === 0 ? (
            <li className="command-palette-empty">No matching commands</li>
          ) : (
            filtered.map((action, index) => (
              <li key={action.id}>
                <button
                  type="button"
                  className={`command-palette-item${index === highlight ? ' highlighted' : ''}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(action)}
                >
                  <span className="command-palette-path">{action.path}</span>
                  {action.shortcut && <span className="command-palette-shortcut">{action.shortcut}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <table className="shortcuts-table">
          <tbody>
            {KEYBOARD_SHORTCUTS.map((row) => (
              <tr key={row.keys}>
                <th>{row.keys}</th>
                <td>{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button type="button" className="btn btn-active" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function MenuChrome({
  menus,
  quickAccess,
  allActions,
  showCommandPalette,
  showShortcutsHelp,
  showLicenses,
  showCredits,
  showAbout,
  onCloseCommandPalette,
  onCloseShortcutsHelp,
  onCloseLicenses,
  onCloseCredits,
  onCloseAbout,
  modeExtras,
}: MenuChromeProps) {
  return (
    <>
      <div className="menu-chrome">
        <MenuBar menus={menus} />
        {(quickAccess.length > 0 || modeExtras) && (
          <div className="quick-toolbar-row">
            <QuickToolbar items={quickAccess} />
            {modeExtras}
          </div>
        )}
      </div>
      {showCommandPalette && <CommandPalette actions={allActions} onClose={onCloseCommandPalette} />}
      {showShortcutsHelp && <ShortcutsModal onClose={onCloseShortcutsHelp} />}
      {showLicenses && <LicensesModal onClose={onCloseLicenses} />}
      {showCredits && <CreditsModal onClose={onCloseCredits} />}
      {showAbout && <AboutModal onClose={onCloseAbout} />}
    </>
  );
}
