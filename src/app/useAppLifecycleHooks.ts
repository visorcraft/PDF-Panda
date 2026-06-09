import { useAppLifecycleLoaders } from './useAppLifecycleLoaders';
import { useAppLifecycleDocument } from './useAppLifecycleDocument';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useSecurityFormState } from './useSecurityFormState';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppRefs } from './useAppRefs';
import type { useHelpChromeState } from './useHelpChromeState';
import type { useAppPageRanges } from './useAppPageRanges';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type SecurityState = ReturnType<typeof useSecurityFormState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type RefsState = ReturnType<typeof useAppRefs>;
type HelpState = ReturnType<typeof useHelpChromeState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;

export type UseAppLifecycleHooksInput = {
  doc: DocumentState;
  modal: ModalState;
  security: SecurityState;
  panels: PanelsState;
  annotation: AnnotationState;
  refs: RefsState;
  pageRanges: PageRangesState;
  ocrAvailable: boolean;
  tesseractReminderSource: HelpState['tesseractReminderSource'];
  setTesseractReminderSource: HelpState['setTesseractReminderSource'];
  tesseractDoNotRemind: boolean;
  setTesseractDoNotRemind: HelpState['setTesseractDoNotRemind'];
  setShowTesseractModal: HelpState['setShowTesseractModal'];
  showToast: (message: string, type?: 'success' | 'error') => void;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  isDirtyRef: DocumentState['isDirtyRef'];
  filePathRef: RefsState['filePathRef'];
  cancelDrawing: () => void;
};

export function useAppLifecycleHooks(input: UseAppLifecycleHooksInput) {
  const loaders = useAppLifecycleLoaders({
    doc: input.doc,
    modal: input.modal,
    panels: input.panels,
    annotation: input.annotation,
    refs: input.refs,
    help: {
      tesseractReminderSource: input.tesseractReminderSource,
      setTesseractReminderSource: input.setTesseractReminderSource,
      tesseractDoNotRemind: input.tesseractDoNotRemind,
      setTesseractDoNotRemind: input.setTesseractDoNotRemind,
      setShowTesseractModal: input.setShowTesseractModal,
    },
    ocrAvailable: input.ocrAvailable,
  });

  const document = useAppLifecycleDocument({ input, loaders });

  return {
    showToast: input.showToast,
    withLoading: input.withLoading,
    loadFormFields: loaders.loadFormFields,
    loadPdfBookmarks: loaders.loadPdfBookmarks,
    loadPdfSignatures: loaders.loadPdfSignatures,
    loadPageSizes: loaders.loadPageSizes,
    shouldShowTesseractReminder: loaders.shouldShowTesseractReminder,
    closeTesseractReminderModal: loaders.closeTesseractReminderModal,
    showLaunchTesseractReminder: loaders.showLaunchTesseractReminder,
    openTesseractGuide: loaders.openTesseractGuide,
    rememberBrowserDirectory: loaders.rememberBrowserDirectory,
    showUnsavedModal: loaders.showUnsavedModal,
    resolveUnsaved: loaders.resolveUnsaved,
    guardUnsaved: loaders.guardUnsaved,
    ...document,
  };
}
