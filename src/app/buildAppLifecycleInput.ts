import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useSecurityFormState } from './useSecurityFormState';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppRefs } from './useAppRefs';
import type { useHelpChromeState } from './useHelpChromeState';
import type { useAppPageRanges } from './useAppPageRanges';
import type { UseAppLifecycleHooksInput } from './useAppLifecycleHooks';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type SecurityState = ReturnType<typeof useSecurityFormState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type RefsState = ReturnType<typeof useAppRefs>;
type HelpState = ReturnType<typeof useHelpChromeState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;

export type BuildAppLifecycleInputArgs = {
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
  cancelDrawing: () => void;
};

export function buildAppLifecycleInput(args: BuildAppLifecycleInputArgs): UseAppLifecycleHooksInput {
  const { doc, refs } = args;
  return {
    doc: args.doc,
    modal: args.modal,
    security: args.security,
    panels: args.panels,
    annotation: args.annotation,
    refs: {
      filePathRef: refs.filePathRef,
      handleMarkdownViewRef: refs.handleMarkdownViewRef,
      loadPdfBookmarksRef: refs.loadPdfBookmarksRef,
      loadPageSizesRef: refs.loadPageSizesRef,
      cancelDrawingRef: refs.cancelDrawingRef,
      keyboardActionsRef: refs.keyboardActionsRef,
      imgRef: refs.imgRef,
      handleSaveRef: refs.handleSaveRef,
    },
    pageRanges: args.pageRanges,
    ocrAvailable: args.ocrAvailable,
    tesseractReminderSource: args.tesseractReminderSource,
    setTesseractReminderSource: args.setTesseractReminderSource,
    tesseractDoNotRemind: args.tesseractDoNotRemind,
    setTesseractDoNotRemind: args.setTesseractDoNotRemind,
    setShowTesseractModal: args.setShowTesseractModal,
    showToast: args.showToast,
    withLoading: args.withLoading,
    isDirtyRef: doc.isDirtyRef,
    filePathRef: refs.filePathRef,
    cancelDrawing: args.cancelDrawing,
  };
}
