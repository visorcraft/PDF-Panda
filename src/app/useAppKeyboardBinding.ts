import type { MutableRefObject } from 'react';
import { buildAppKeyboardActions, type BuildAppKeyboardActionsInput } from './buildAppKeyboardActions';
import type { AppKeyboardActions } from './buildAppKeyboardActions';
import { useAppKeyboard } from './useAppKeyboard';

export function useAppKeyboardBinding(
  keyboardActionsRef: MutableRefObject<AppKeyboardActions>,
  input: BuildAppKeyboardActionsInput,
  activeSurface: 'document' | 'settings' = 'document',
) {
  keyboardActionsRef.current = buildAppKeyboardActions(input);
  useAppKeyboard(keyboardActionsRef, activeSurface);
}
