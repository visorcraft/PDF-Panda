import type { MutableRefObject } from 'react';
import { buildAppKeyboardActions, type BuildAppKeyboardActionsInput } from './buildAppKeyboardActions';
import type { AppKeyboardActions } from './buildAppKeyboardActions';
import { useAppKeyboard } from './useAppKeyboard';
import type { ShortcutBindings } from './useShortcutBindingsState';

export function useAppKeyboardBinding(
  keyboardActionsRef: MutableRefObject<AppKeyboardActions>,
  input: BuildAppKeyboardActionsInput,
  shortcutBindings: ShortcutBindings,
  activeSurface: 'document' | 'settings' = 'document',
) {
  keyboardActionsRef.current = buildAppKeyboardActions(input);
  useAppKeyboard(keyboardActionsRef, shortcutBindings, activeSurface);
}
