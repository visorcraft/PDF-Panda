import { useEffect } from 'react';

export function useEscapeClose(onClose: () => void, restoreFocus?: boolean) {
  useEffect(() => {
    const previous = document.activeElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (restoreFocus && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [onClose, restoreFocus]);
}
