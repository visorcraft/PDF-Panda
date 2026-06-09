import type { UseAppPdfActionsInput } from './useAppPdfActions';
import type { useAppModalState } from './useAppModalState';
import type { useSecurityFormState } from './useSecurityFormState';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppPageRanges } from './useAppPageRanges';
import type { useAppRefs } from './useAppRefs';
import { modalPdfActionFields, marginPdfActionFields } from './buildAppPdfActionsModalFields';
import {
  securityPdfActionFields,
  panelsPdfActionFields,
  documentPdfActionFields,
  pageRangesPdfActionFields,
} from './buildAppPdfActionsDomainFields';
import {
  annotationPdfActionFields,
  drawingPdfActionFields,
  refsPdfActionFields,
  type DrawingGestureSlice,
} from './buildAppPdfActionsAnnotFields';

export type { DrawingGestureSlice };

type ModalState = ReturnType<typeof useAppModalState>;
type SecurityState = ReturnType<typeof useSecurityFormState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type DocumentState = ReturnType<typeof useAppDocumentState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;
type RefsState = ReturnType<typeof useAppRefs>;

export type AppPdfActionsRuntime = Pick<
  UseAppPdfActionsInput,
  | 'loadFormFields'
  | 'loadPageSizes'
  | 'loadPdfBookmarks'
  | 'loadPdfFromPath'
  | 'loadPdfSignatures'
  | 'loadThumbnails'
  | 'markPdfEdited'
  | 'markSaved'
  | 'reloadOpenPdf'
  | 'rememberBrowserDirectory'
  | 'rememberOpenedPdf'
  | 'renderPage'
  | 'setAnnotations'
  | 'shouldShowTesseractReminder'
  | 'showToast'
  | 'withLoading'
  | 'setShowTesseractModal'
  | 'setTesseractReminderSource'
>;

export type BuildAppPdfActionsInputArgs = {
  modal: ModalState;
  security: SecurityState;
  panels: PanelsState;
  annotation: AnnotationState;
  document: DocumentState;
  drawing: DrawingGestureSlice;
  pageRanges: PageRangesState;
  refs: Pick<RefsState, 'cancelDrawingRef' | 'handleSaveRef' | 'handleMarkdownViewRef' | 'imgRef'>;
  runtime: AppPdfActionsRuntime;
};

export function buildAppPdfActionsInput(args: BuildAppPdfActionsInputArgs): UseAppPdfActionsInput {
  const { modal: m, security: s, panels: p, annotation: a, document: d, drawing: g, pageRanges: r, refs, runtime } = args;
  return {
    ...modalPdfActionFields(m),
    ...securityPdfActionFields(s),
    ...panelsPdfActionFields(p),
    ...annotationPdfActionFields(a),
    ...documentPdfActionFields(d),
    ...drawingPdfActionFields(g),
    ...pageRangesPdfActionFields(r),
    ...refsPdfActionFields(refs),
    ...marginPdfActionFields(m),
    extractEndPage: r.extractRange.endPage,
    extractStartPage: r.extractRange.startPage,
    pngExportEndPage: r.pngExportRange.endPage,
    pngExportScope: r.pngExportRange.scope,
    pngExportStartPage: r.pngExportRange.startPage,
    ...runtime,
  };
}
