import { buildAppPdfActionsInput, type AppPdfActionsRuntime } from './buildAppPdfActionsInput';
import { useAppPdfActions } from './useAppPdfActions';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useAppPageRanges } from './useAppPageRanges';
import type { useAppRefs } from './useAppRefs';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useHelpChromeState } from './useHelpChromeState';
import type { useSecurityFormState } from './useSecurityFormState';
import type { DrawingGestureSlice } from './buildAppPdfActionsInput';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type SecurityState = ReturnType<typeof useSecurityFormState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;
type RefsState = ReturnType<typeof useAppRefs>;
type HelpState = ReturnType<typeof useHelpChromeState>;

export type AppPdfActionsRuntimeSlice = Omit<AppPdfActionsRuntime, 'setShowTesseractModal' | 'setTesseractReminderSource'>;

export type UseAppPdfActionsBindingInput = {
  doc: DocumentState;
  modal: ModalState;
  security: SecurityState;
  panels: PanelsState;
  annotation: AnnotationState;
  drawing: DrawingGestureSlice;
  pageRanges: PageRangesState;
  refs: Pick<RefsState, 'cancelDrawingRef' | 'handleSaveRef' | 'handleMarkdownViewRef' | 'imgRef'>;
  help: Pick<HelpState, 'setShowTesseractModal' | 'setTesseractReminderSource'>;
  runtime: AppPdfActionsRuntimeSlice;
};

export function useAppPdfActionsBinding(input: UseAppPdfActionsBindingInput) {
  return useAppPdfActions(
    buildAppPdfActionsInput({
      modal: input.modal,
      security: input.security,
      panels: input.panels,
      annotation: input.annotation,
      document: input.doc,
      drawing: input.drawing,
      pageRanges: input.pageRanges,
      refs: input.refs,
      runtime: {
        ...input.runtime,
        setShowTesseractModal: input.help.setShowTesseractModal,
        setTesseractReminderSource: input.help.setTesseractReminderSource,
      },
    }),
  );
}
