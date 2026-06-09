import { buildAppKeyboardActions, type BuildAppKeyboardActionsInput } from './buildAppKeyboardActions';

export type BuildAppKeyboardInput = BuildAppKeyboardActionsInput;

export function buildAppKeyboardInput(input: BuildAppKeyboardInput) {
  return buildAppKeyboardActions(input);
}
