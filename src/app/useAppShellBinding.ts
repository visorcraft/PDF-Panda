import { buildAppShellRenderInput } from '../chrome/buildAppShellRenderInput';
import type { AppPdfActions } from './useAppPdfActions';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppModalState } from './useAppModalState';
import type { useAppRefs } from './useAppRefs';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useDrawingGesture } from '../viewer/useDrawingGesture';
import type { useHelpChromeState } from './useHelpChromeState';
import type { useAppViewerWorkflow } from './useAppViewerWorkflow';
import type { useAppLifecycleSlices } from './useAppLifecycleSlices';
import type { buildAppMenus } from '../menu/buildAppMenus';
import type { BuildAppModalCtxSourceInput } from '../modals/buildAppModalCtxSource';
import type { BuildAppChromeSourceInput } from '../chrome/buildAppChromeSource';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type ModalState = ReturnType<typeof useAppModalState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type DrawingState = ReturnType<typeof useDrawingGesture>;
type HelpState = ReturnType<typeof useHelpChromeState>;
type RefsState = ReturnType<typeof useAppRefs>;
type ViewerWorkflow = ReturnType<typeof useAppViewerWorkflow>;
type Slices = ReturnType<typeof useAppLifecycleSlices>;
type AppMenus = ReturnType<typeof buildAppMenus>;

export type UseAppShellBindingInput = {
  doc: DocumentState;
  modal: ModalState;
  panels: PanelsState;
  annotation: AnnotationState;
  drawing: DrawingState;
  help: HelpState;
  refs: Pick<RefsState, 'imgRef'>;
  pdfActions: AppPdfActions;
  windowTitle: string;
  appMenus: AppMenus;
  modeToolbarExtras: BuildAppChromeSourceInput['modeExtras'];
  modalCtx: BuildAppModalCtxSourceInput;
  slices: Slices;
  viewerWorkflow: ViewerWorkflow;
};

export function useAppShellBinding(input: UseAppShellBindingInput) {
  const { viewer, search } = input.slices;
  const { viewerWorkflow } = input;

  return buildAppShellRenderInput({
    doc: input.doc,
    modal: input.modal,
    panels: input.panels,
    annotation: input.annotation,
    drawing: input.drawing,
    help: input.help,
    refs: input.refs,
    pdfActions: input.pdfActions,
    windowTitle: input.windowTitle,
    appMenus: input.appMenus,
    modeExtras: input.modeToolbarExtras,
    modalCtx: input.modalCtx,
    printPages: viewer.printPages,
    viewer: {
      thumbnails: viewer.thumbnails,
      imageSrc: viewer.imageSrc,
      annotations: viewer.annotations,
      scrollRef: viewerWorkflow.scrollRef,
      handleWheel: viewerWorkflow.handleWheel,
      handleImageLoad: viewerWorkflow.handleImageLoad,
      handleDragStart: viewerWorkflow.handleDragStart,
      handleDragOver: viewerWorkflow.handleDragOver,
      handleDrop: viewerWorkflow.handleDrop,
      goToPage: viewer.goToPage,
      openPdf: viewer.openPdf,
      loadPdfBookmarks: input.slices.loaders.loadPdfBookmarks,
      loadPdfSignatures: input.slices.loaders.loadPdfSignatures,
      activeSearchRect: search.activeSearchRect,
      commitPage: viewerWorkflow.commitPage,
      commitZoom: viewerWorkflow.commitZoom,
      zoomIn: viewerWorkflow.zoomIn,
      zoomOut: viewerWorkflow.zoomOut,
      resetZoom: viewerWorkflow.resetZoom,
    },
  });
}
