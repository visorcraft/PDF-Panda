import type { DocumentTabInfo } from '../app/documentSessionTypes';

type TabBarProps = {
  tabs: DocumentTabInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps) {
  if (tabs.length <= 1) return null;

  return (
    <div className="tab-bar" role="tablist">
      <div className="tab-bar-scroll">
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
    </div>
  );
}
