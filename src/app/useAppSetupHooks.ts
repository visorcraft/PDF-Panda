import { useAppBootstrap } from './useAppBootstrap';
import { usePageZoomInputSync } from './usePageZoomInputSync';
import { useWindowTitle } from './useWindowTitle';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useAppRefs } from './useAppRefs';
import type { useHelpChromeState } from './useHelpChromeState';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type RefsState = ReturnType<typeof useAppRefs>;
type HelpState = ReturnType<typeof useHelpChromeState>;

export type UseAppSetupHooksInput = {
  doc: DocumentState;
  modal: ModalState;
  help: HelpState;
  refs: Pick<RefsState, 'filePathRef'>;
  onShowTesseractReminder: () => void;
};

export function useAppSetupHooks(input: UseAppSetupHooksInput) {
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
