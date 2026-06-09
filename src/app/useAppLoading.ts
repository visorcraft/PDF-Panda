import { useCallback } from 'react';

type ToastState = { message: string; type: 'success' | 'error' } | null;

type UseAppLoadingOptions = {
  setToast: (toast: ToastState) => void;
  setLoading: (loading: boolean) => void;
};

export function useAppLoading({ setToast, setLoading }: UseAppLoadingOptions) {
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, [setToast]);

  const withLoading = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setLoading(true);
    try {
      return await fn();
    } catch (err) {
      showToast(String(err), 'error');
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  return { showToast, withLoading };
}
