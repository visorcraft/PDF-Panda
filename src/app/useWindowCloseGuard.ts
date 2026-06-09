import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, type MutableRefObject } from 'react';

type UseWindowCloseGuardOptions = {
  isDirtyRef: MutableRefObject<boolean>;
  pendingNavRef: MutableRefObject<(() => void) | null>;
  setShowUnsavedModal: (open: boolean) => void;
};

export function useWindowCloseGuard({
  isDirtyRef,
  pendingNavRef,
  setShowUnsavedModal,
}: UseWindowCloseGuardOptions) {
  useEffect(() => {
    const w = getCurrentWindow();
    const unlisten = w.onCloseRequested((event) => {
      if (isDirtyRef.current) {
        event.preventDefault();
        pendingNavRef.current = () => w.destroy();
        setShowUnsavedModal(true);
      }
    });
    return () => { void unlisten.then((f) => f()); };
  }, [isDirtyRef, pendingNavRef, setShowUnsavedModal]);
}
