import type { UseAppPdfActionsInput } from './useAppPdfActions';
import type { ModalState } from './useAppModalState';
import type { SecurityState } from './useSecurityFormState';
import type { PanelsState } from './useDocumentPanelsState';
import type { AnnotationState } from './useAnnotationDraftState';
import type { DocumentState } from './useAppDocumentState';
import type { PageRangesState } from './useAppPageRanges';
import type { RefsState } from './useAppRefs';
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

export type AppPdfActionsRuntimeExtras = {
  openTesseractGuide: () => void;
};

export type BuildAppPdfActionsInputArgs = {
  modal: ModalState;
  security: SecurityState;
  panels: PanelsState;
  annotation: AnnotationState;
  document: DocumentState;
  drawing: DrawingGestureSlice;
  pageRanges: PageRangesState;
  refs: Pick<RefsState, 'cancelDrawingRef' | 'handleSaveRef' | 'handleMarkdownViewRef' | 'imgRef'>;
  runtime: AppPdfActionsRuntime & AppPdfActionsRuntimeExtras;
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
    openTesseractGuide: runtime.openTesseractGuide,
  };
}
