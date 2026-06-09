import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, type MutableRefObject } from 'react';

type UseWindowTitleOptions = {
  filePath: string;
  originalPath: string;
  isDirty: boolean;
  isDirtyRef: MutableRefObject<boolean>;
  filePathRef: MutableRefObject<string>;
};

export function useWindowTitle(opts: UseWindowTitleOptions) {
  useEffect(() => {
    opts.filePathRef.current = opts.filePath;
  }, [opts.filePath, opts.filePathRef]);

  useEffect(() => {
    opts.isDirtyRef.current = opts.isDirty;
    const name = opts.originalPath ? (opts.originalPath.split('/').pop() ?? '') : '';
    const title = name ? `${opts.isDirty ? '• ' : ''}${name} — PDF Panda` : 'PDF Panda';
    void getCurrentWindow().setTitle(title);
  }, [opts.isDirty, opts.originalPath, opts.isDirtyRef]);
}
