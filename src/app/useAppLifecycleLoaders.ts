import { usePanelLoaders } from './usePanelLoaders';
import { usePageEditsLoader } from './usePageEditsLoader';
import { useTesseractReminder } from './useTesseractReminder';
import { useRememberBrowserDirectory } from './useRememberBrowserDirectory';
import { useUnsavedGuard } from './useUnsavedGuard';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useHelpChromeState } from './useHelpChromeState';
import type { useAppRefs } from './useAppRefs';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type HelpState = ReturnType<typeof useHelpChromeState>;
type RefsState = ReturnType<typeof useAppRefs>;

export type UseAppLifecycleLoadersInput = {
  doc: Pick<DocumentState, 'filePath' | 'isDirty' | 'setIsDirty' | 'isDirtyRef'>;
  modal: Pick<ModalState, 'setPageSizes' | 'setLastBrowserDir'>;
  panels: Pick<
    PanelsState,
    'setFormFields' | 'setFormDrafts' | 'setPdfBookmarks' | 'setPdfSignatures' | 'setSignatureVerification'
  >;
  annotation: Pick<AnnotationState, 'setPageTextEdits' | 'setPageVectorEdits'>;
  refs: Pick<RefsState, 'handleMarkdownViewRef' | 'handleSaveRef' | 'loadPdfBookmarksRef' | 'loadPageSizesRef'>;
  help: Pick<
    HelpState,
    | 'tesseractReminderSource'
    | 'setTesseractReminderSource'
    | 'tesseractDoNotRemind'
    | 'setTesseractDoNotRemind'
    | 'setShowTesseractModal'
  >;
  ocrAvailable: boolean;
};

export function useAppLifecycleLoaders(input: UseAppLifecycleLoadersInput) {
  const { loadFormFields, loadPdfBookmarks, loadPdfSignatures, loadPageSizes } = usePanelLoaders({
    filePath: input.doc.filePath,
    setFormFields: input.panels.setFormFields,
    setFormDrafts: input.panels.setFormDrafts,
    setPdfBookmarks: input.panels.setPdfBookmarks,
    setPdfSignatures: input.panels.setPdfSignatures,
    setSignatureVerification: input.panels.setSignatureVerification,
    setPageSizes: input.modal.setPageSizes,
  });
  input.refs.loadPdfBookmarksRef.current = (path) => { void loadPdfBookmarks(path); };
  input.refs.loadPageSizesRef.current = (path) => { void loadPageSizes(path); };

  const { loadPageEdits } = usePageEditsLoader({
    setPageTextEdits: input.annotation.setPageTextEdits,
    setPageVectorEdits: input.annotation.setPageVectorEdits,
  });

  const tesseract = useTesseractReminder({
    ocrAvailable: input.ocrAvailable,
    tesseractReminderSource: input.help.tesseractReminderSource,
    setTesseractReminderSource: input.help.setTesseractReminderSource,
    tesseractDoNotRemind: input.help.tesseractDoNotRemind,
    setTesseractDoNotRemind: input.help.setTesseractDoNotRemind,
    setShowTesseractModal: input.help.setShowTesseractModal,
    handleMarkdownViewRef: input.refs.handleMarkdownViewRef,
  });

  const rememberBrowserDirectory = useRememberBrowserDirectory({ setLastBrowserDir: input.modal.setLastBrowserDir });

  const unsaved = useUnsavedGuard({
    isDirty: input.doc.isDirty,
    setIsDirty: input.doc.setIsDirty,
    onSave: () => input.refs.handleSaveRef.current(),
  });

  useWindowCloseGuard({
    isDirtyRef: input.doc.isDirtyRef,
    pendingNavRef: unsaved.pendingNavRef,
    setShowUnsavedModal: unsaved.setShowUnsavedModal,
  });

  return {
    loadFormFields,
    loadPdfBookmarks,
    loadPdfSignatures,
    loadPageSizes,
    loadPageEdits,
    rememberBrowserDirectory,
    ...tesseract,
    showUnsavedModal: unsaved.showUnsavedModal,
    guardUnsaved: unsaved.guardUnsaved,
    resolveUnsaved: unsaved.resolveUnsaved,
  };
}
