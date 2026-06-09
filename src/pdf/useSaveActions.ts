import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';

type UseSaveActionsOptions = {
  filePath: string;
  originalPath: string;
  nativeDialogs: boolean;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  markSaved: () => void;
  showToast: (msg: string, kind?: 'error') => void;
  saveAsViaNativeDialog: () => Promise<void>;
  setSaveAsPath: (path: string) => void;
  setShowSaveAsModal: (open: boolean) => void;
};

export function useSaveActions(opts: UseSaveActionsOptions) {
  const handleSave = useCallback(async () => {
    if (!opts.filePath || !opts.originalPath) return;
    await opts.withLoading(async () => {
      await invoke('save_working_copy', { working: opts.filePath, target: opts.originalPath });
      opts.markSaved();
      opts.showToast('Saved');
    });
  }, [opts]);

  const openSaveAs = useCallback(() => {
    if (opts.nativeDialogs) {
      void opts.saveAsViaNativeDialog();
      return;
    }
    opts.setSaveAsPath(opts.originalPath);
    opts.setShowSaveAsModal(true);
  }, [opts]);

  return { handleSave, openSaveAs };
}
