import { invoke } from '@tauri-apps/api/core';

export type AnnotationEditDeps = {
  filePath: string;
  currentPage: number;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  markPdfEdited: () => void;
  refreshAnnotations: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
};

export type AnnotationRemoveRequest = {
  command: string;
  index: number;
  toast: string;
};

export async function runAnnotationRemove(
  deps: AnnotationEditDeps,
  { command, index, toast }: AnnotationRemoveRequest,
): Promise<void> {
  if (!deps.filePath) return;
  await deps.withLoading(async () => {
    await invoke(command, { path: deps.filePath, pageIndex: deps.currentPage, index });
    deps.markPdfEdited();
    await deps.refreshAnnotations();
    deps.showToast(toast);
  });
}
