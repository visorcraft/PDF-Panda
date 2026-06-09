import { useAppModalStateFile } from './useAppModalStateFile';
import { useAppModalStateMergeInsert } from './useAppModalStateMergeInsert';
import { useAppModalStatePageOps } from './useAppModalStatePageOps';
import { useAppModalStateRange } from './useAppModalStateRange';

export function useAppModalState() {
  return {
    ...useAppModalStateFile(),
    ...useAppModalStatePageOps(),
    ...useAppModalStateRange(),
    ...useAppModalStateMergeInsert(),
  };
}
