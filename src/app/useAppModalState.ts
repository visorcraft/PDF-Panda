import { useAppModalStateFile } from './useAppModalStateFile';
import { useAppModalStateMergeInsert } from './useAppModalStateMergeInsert';
import { useAppModalStatePageOps } from './useAppModalStatePageOps';
import { useAppModalStateRange } from './useAppModalStateRange';
import { useAppModalStateRotate } from './useAppModalStateRotate';

export function useAppModalState() {
  return {
    ...useAppModalStateFile(),
    ...useAppModalStatePageOps(),
    ...useAppModalStateRange(),
    ...useAppModalStateMergeInsert(),
    ...useAppModalStateRotate(),
  };
}

/** Canonical alias for this hook's state shape. */
export type ModalState = ReturnType<typeof useAppModalState>;
