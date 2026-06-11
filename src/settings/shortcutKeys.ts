import type { ShortcutCommandId } from './shortcutRegistry';

export type Shortcut = string;

export type Conflict = {
  commandId: ShortcutCommandId;
  shortcut: Shortcut;
};

const MODIFIER_ORDER = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const;

const KEY_ALIASES: Record<string, string> = {
  Control: 'Ctrl',
  Esc: 'Escape',
  ' ': 'Space',
  Spacebar: 'Space',
  Minus: '-',
};

const MODIFIER_NAMES = new Set(['Ctrl', 'Alt', 'Shift', 'Meta']);

const RESERVED_SHORTCUTS = new Set<string>([
  'Escape',
  'F1',
  'F5',
  'F12',
  'Ctrl+T',
  'Ctrl+Shift+T',
  'Ctrl+N',
  'Ctrl+Shift+N',
  'Ctrl+Shift+W',
  'Ctrl+Shift+R',
  'Ctrl+Shift+C',
]);

function normalizeKey(key: string): string {
  const upper = key.length === 1 ? key.toUpperCase() : key;
  return KEY_ALIASES[upper] ?? upper;
}

export function eventToShortcut(event: KeyboardEvent | React.KeyboardEvent): Shortcut | null {
  const key = normalizeKey(event.key);
  if (!key || MODIFIER_NAMES.has(key)) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  // Reject raw text-entry keys without modifiers unless they are current document tool defaults
  // (single letter keys used by annotation tools: H, N, D, S, T, X, E, G, I, F).
  const toolLetters = new Set(['H', 'N', 'D', 'S', 'T', 'X', 'E', 'G', 'I', 'F']);
  if (parts.length === 0 && !toolLetters.has(key) && key.length === 1) {
    return null;
  }

  parts.push(key);
  return parts.join('+');
}

export function normalizeShortcut(input: string): Shortcut | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const rawParts = trimmed.split(/\s*\+\s*/);
  const normalizedParts = rawParts.map((part) => {
    const upper = part.toUpperCase();
    if (MODIFIER_NAMES.has(upper === 'CONTROL' ? 'Ctrl' : upper)) {
      return upper === 'CONTROL' ? 'Ctrl' : upper.charAt(0) + upper.slice(1).toLowerCase();
    }
    return normalizeKey(part.trim());
  });

  const modifiers = normalizedParts.filter((part) =>
    (MODIFIER_ORDER as readonly string[]).includes(part),
  );
  const keys = normalizedParts.filter(
    (part) => !(MODIFIER_ORDER as readonly string[]).includes(part),
  );

  if (keys.length !== 1) return null;
  const key = keys[0];
  if (!key) return null;

  const orderedModifiers = MODIFIER_ORDER.filter((mod) => modifiers.includes(mod));
  return [...orderedModifiers, key].join('+');
}

export function shortcutToDisplay(shortcut: Shortcut, isMac = false): string {
  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'Meta') return isMac ? '⌘' : 'Win';
      if (part === 'Ctrl') return isMac ? '⌃' : 'Ctrl';
      if (part === 'Alt') return isMac ? '⌥' : 'Alt';
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      if (part === 'Plus') return '+';
      return part;
    })
    .join(isMac ? '' : '+');
}

export function isShortcutConflict(
  bindings: Record<ShortcutCommandId, string[]>,
  commandId: ShortcutCommandId,
  shortcut: Shortcut,
): Conflict | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;

  for (const [otherCommandId, shortcuts] of Object.entries(bindings) as [ShortcutCommandId, string[]][]) {
    if (otherCommandId === commandId) continue;
    if (shortcuts.some((s) => normalizeShortcut(s) === normalized)) {
      return { commandId: otherCommandId, shortcut: normalized };
    }
  }
  return null;
}

export function isReservedShortcut(shortcut: Shortcut): boolean {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;
  return RESERVED_SHORTCUTS.has(normalized);
}

const STORAGE_KEY = 'pdf-panda-shortcuts-v1';
const SCHEMA_VERSION = 1;

type PersistedShortcuts = {
  version: number;
  overrides: Partial<Record<ShortcutCommandId, string[]>>;
};

export function loadShortcutOverrides(): Partial<Record<ShortcutCommandId, string[]>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const persisted = parsed as PersistedShortcuts;
    if (persisted.version !== SCHEMA_VERSION) return {};

    const overrides: Partial<Record<ShortcutCommandId, string[]>> = {};
    for (const [commandId, shortcuts] of Object.entries(persisted.overrides)) {
      if (Array.isArray(shortcuts) && shortcuts.every((s) => typeof s === 'string' && normalizeShortcut(s))) {
        overrides[commandId as ShortcutCommandId] = shortcuts
          .map((s) => normalizeShortcut(s))
          .filter((s): s is string => s !== null);
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveShortcutOverrides(
  overrides: Partial<Record<ShortcutCommandId, string[]>>,
): void {
  try {
    const payload: PersistedShortcuts = {
      version: SCHEMA_VERSION,
      overrides,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}
