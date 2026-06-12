import { buildAppShellRenderInput } from '../chrome/buildAppShellRenderInput';
import type { AppPdfActions } from './useAppPdfActions';
import type { AnnotationState } from './useAnnotationDraftState';
import type { DocumentState } from './useAppDocumentState';
import type { ModalState } from './useAppModalState';
import type { RefsState } from './useAppRefs';
import type { PanelsState } from './useDocumentPanelsState';
import type { useDrawingGesture } from '../viewer/useDrawingGesture';
import type { HelpState } from './useHelpChromeState';
import type { useAppViewerWorkflow } from './useAppViewerWorkflow';
import type { useAppLifecycleSlices } from './useAppLifecycleSlices';
import type { AppMenus } from '../menu/types';
import type { AppModalsRuntime } from '../modals/appModalsContext';
import type { BuildAppChromeSourceInput } from '../chrome/buildAppChromeSource';
import type { AppSurface } from './useAppSurfaceState';
import type { ShortcutBindings } from './useShortcutBindingsState';

type DrawingState = ReturnType<typeof useDrawingGesture>;
type ViewerWorkflow = ReturnType<typeof useAppViewerWorkflow>;
type Slices = ReturnType<typeof useAppLifecycleSlices>;

export type UseAppShellBindingInput = {
  doc: DocumentState;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
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
  modalCtx: AppModalsRuntime;
  slices: Slices;
  viewerWorkflow: ViewerWorkflow;
  surface: { activeSurface: AppSurface; closeSettings: () => void };
  shortcutBindings: ShortcutBindings;
};

export function useAppShellBinding(input: UseAppShellBindingInput) {
  const { viewer, search } = input.slices;
  const { viewerWorkflow } = input;

  return buildAppShellRenderInput({
    doc: input.doc,
    onSelectTab: input.onSelectTab,
    onCloseTab: input.onCloseTab,
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
    activeSurface: input.surface.activeSurface,
    closeSettings: input.surface.closeSettings,
    shortcutBindings: input.shortcutBindings,
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
      goToPage: viewerWorkflow.goToPage,
      continuous: viewerWorkflow.continuous,
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
