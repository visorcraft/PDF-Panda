import type { MutableRefObject } from 'react';
import type { BuildAppKeyboardActionsInput } from './buildAppKeyboardActions';
import { buildAppKeyboardInput } from './buildAppKeyboardInput';
import type { AppKeyboardActions } from './buildAppKeyboardActions';
import { useAppKeyboard } from './useAppKeyboard';

export function useAppKeyboardBinding(
  keyboardActionsRef: MutableRefObject<AppKeyboardActions>,
  input: BuildAppKeyboardActionsInput,
) {
  keyboardActionsRef.current = buildAppKeyboardInput(input);
  useAppKeyboard(keyboardActionsRef);
}
