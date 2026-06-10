import { buildAppPdfActionsInput, type AppPdfActionsRuntime, type AppPdfActionsRuntimeExtras } from './buildAppPdfActionsInput';
import { useAppPdfActions } from './useAppPdfActions';
import type { AnnotationState } from './useAnnotationDraftState';
import type { DocumentState } from './useAppDocumentState';
import type { ModalState } from './useAppModalState';
import type { PageRangesState } from './useAppPageRanges';
import type { RefsState } from './useAppRefs';
import type { PanelsState } from './useDocumentPanelsState';
import type { HelpState } from './useHelpChromeState';
import type { SecurityState } from './useSecurityFormState';
import type { DrawingGestureSlice } from './buildAppPdfActionsInput';

export type AppPdfActionsRuntimeSlice = Omit<AppPdfActionsRuntime, 'setShowTesseractModal' | 'setTesseractReminderSource'>
  & AppPdfActionsRuntimeExtras;

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
