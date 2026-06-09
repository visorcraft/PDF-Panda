import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, type MutableRefObject } from 'react';

type UseWindowTitleOptions = {
  filePath: string;
  originalPath: string;
  isDirty: boolean;
  isDirtyRef: MutableRefObject<boolean>;
  filePathRef: MutableRefObject<string>;
};

export function useWindowTitle(opts: UseWindowTitleOptions) {
  const windowTitle = useMemo(() => {
    const name = opts.originalPath ? (opts.originalPath.split('/').pop() ?? '') : '';
    return name ? `${opts.isDirty ? '• ' : ''}${name} — PDF Panda` : 'PDF Panda';
  }, [opts.isDirty, opts.originalPath]);

  useEffect(() => {
    opts.filePathRef.current = opts.filePath;
  }, [opts.filePath, opts.filePathRef]);

  useEffect(() => {
    opts.isDirtyRef.current = opts.isDirty;
    void getCurrentWindow().setTitle(windowTitle);
  }, [opts.isDirty, opts.isDirtyRef, windowTitle]);

  return { windowTitle };
}
