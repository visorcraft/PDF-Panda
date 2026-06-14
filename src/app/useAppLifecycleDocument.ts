import { useAppLifecycleBrowserSearch } from './useAppLifecycleBrowserSearch';
import { useAppLifecycleOpen } from './useAppLifecycleOpen';
import type { UseAppLifecycleDocumentInput } from './appLifecycleTypes';

export function useAppLifecycleDocument({ input, loaders }: UseAppLifecycleDocumentInput) {
  const open = useAppLifecycleOpen({ input, loaders });
  const { browser, search, printPages, handlePrint, openPrintDialog, closePdf } = useAppLifecycleBrowserSearch({ input, loaders, open });

  return {
    ...open,
    browser,
    search,
    printPages,
    handlePrint,
    openPrintDialog,
    closePdf,
  };
}
