import { useAppBootstrap } from './useAppBootstrap';
import { usePageZoomInputSync } from './usePageZoomInputSync';
import { useWindowTitle } from './useWindowTitle';
import { useSourcePdfPageCounts } from './useSourcePdfPageCounts';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useAppPageRanges } from './useAppPageRanges';
import type { useAppRefs } from './useAppRefs';
import type { useHelpChromeState } from './useHelpChromeState';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;
type RefsState = ReturnType<typeof useAppRefs>;
type HelpState = ReturnType<typeof useHelpChromeState>;

export type UseAppSetupHooksInput = {
  doc: DocumentState;
  modal: ModalState;
  help: HelpState;
  pageRanges: PageRangesState;
  refs: Pick<RefsState, 'filePathRef'>;
  onShowTesseractReminder: () => void;
};

export function useAppSetupHooks(input: UseAppSetupHooksInput) {
  useSourcePdfPageCounts({
    insertFilePath: input.modal.insertFilePath,
    mergeFilePath: input.modal.mergeFilePath,
    insertRange: input.pageRanges.insertRange,
    mergeRange: input.pageRanges.mergeRange,
    setInsertSourcePageCount: input.modal.setInsertSourcePageCount,
    setMergeSourcePageCount: input.modal.setMergeSourcePageCount,
  });

  useAppBootstrap({
    onNativeDialogs: input.modal.setNativeDialogs,
    onOcrAvailable: input.doc.setOcrAvailable,
    onTesseractInstallGuide: input.help.setTesseractInstallGuide,
    onShowTesseractReminder: input.onShowTesseractReminder,
  });

  const { windowTitle } = useWindowTitle({
    filePath: input.doc.filePath,
    originalPath: input.doc.originalPath,
    isDirty: input.doc.isDirty,
    isDirtyRef: input.doc.isDirtyRef,
    filePathRef: input.refs.filePathRef,
  });

  usePageZoomInputSync({
    currentPage: input.doc.currentPage,
    setPageInput: input.doc.setPageInput,
    zoom: input.doc.zoom,
    setZoomInput: input.doc.setZoomInput,
  });

  return { windowTitle };
}
