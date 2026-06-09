import { useMemo } from 'react';
import { createStructuralEditRunner, type StructuralEditDeps } from './runStructuralEdit';

export function useStructuralEdit(deps: StructuralEditDeps) {
  return useMemo(
    () => createStructuralEditRunner(deps),
    [deps.filePath, deps.currentPage, deps.withLoading, deps.markPdfEdited, deps.reloadOpenPdf, deps.showToast],
  );
}
