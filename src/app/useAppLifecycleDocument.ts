import type { useAppLifecycleLoaders } from './useAppLifecycleLoaders';
import { useAppLifecycleBrowserSearch } from './useAppLifecycleBrowserSearch';
import { useAppLifecycleOpen } from './useAppLifecycleOpen';

type LifecycleInput = import('./useAppLifecycleHooks').UseAppLifecycleHooksInput;
type Loaders = ReturnType<typeof useAppLifecycleLoaders>;

export type UseAppLifecycleDocumentInput = {
  input: LifecycleInput;
  loaders: Loaders;
};

export function useAppLifecycleDocument({ input, loaders }: UseAppLifecycleDocumentInput) {
  const open = useAppLifecycleOpen({ input, loaders });
  const { browser, search, printPages, handlePrint, closePdf } = useAppLifecycleBrowserSearch({ input, loaders, open });

  return {
    ...open,
    browser,
    search,
    printPages,
    handlePrint,
    closePdf,
  };
}
