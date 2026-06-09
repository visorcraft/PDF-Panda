import type { FlatMenuAction, MenuAction, MenuEntry, MenuRoot } from './types';

export const sep = (): MenuEntry => ({ separator: true });

export const act = (
  id: string,
  label: string,
  run: () => void,
  opts?: Partial<Pick<MenuAction, 'shortcut' | 'disabled' | 'danger' | 'active'>>,
): MenuAction => ({ id, label, run, ...opts });

export const sub = (label: string, items: MenuEntry[]): MenuEntry => ({ label, items });

export const multiPage = (pageCount: number | null) => pageCount !== null && pageCount >= 2;
export const canDeletePage = (pageCount: number | null) => pageCount !== null && pageCount > 1;

export function flattenMenuActions(menus: MenuRoot[]): FlatMenuAction[] {
  const out: FlatMenuAction[] = [];
  const walk = (entries: MenuEntry[], prefix: string) => {
    for (const entry of entries) {
      if ('separator' in entry) continue;
      if ('items' in entry && !('id' in entry)) {
        walk(entry.items, prefix ? `${prefix} › ${entry.label}` : entry.label);
        continue;
      }
      const action = entry as MenuAction;
      out.push({ ...action, path: prefix ? `${prefix} › ${action.label}` : action.label });
    }
  };
  for (const menu of menus) {
    walk(menu.items, menu.label);
  }
  return out;
}
