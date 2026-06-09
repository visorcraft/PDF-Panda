import type { MutableRefObject } from 'react';
import { buildAppKeyboardActions, type BuildAppKeyboardActionsInput } from './buildAppKeyboardActions';
import { useAppKeyboard, type AppKeyboardActions } from './useAppKeyboard';

export function useAppKeyboardBinding(
  keyboardActionsRef: MutableRefObject<AppKeyboardActions>,
  input: BuildAppKeyboardActionsInput,
) {
  keyboardActionsRef.current = buildAppKeyboardActions(input);
  useAppKeyboard(keyboardActionsRef);
}
