import { buildAppShellChromeInput } from './buildAppShellChromeInput';
import { buildAppShellPageZoomInput } from './buildAppShellPageZoomInput';
import { buildAppShellSource } from './buildAppShellSource';
import { buildHelpChromeInput } from '../app/buildHelpChromeInput';
import { buildAppShellViewerInput } from '../viewer/buildAppShellViewerInput';
import type { AppPdfActions } from '../app/useAppPdfActions';
import type { useAnnotationDraftState } from '../app/useAnnotationDraftState';
import type { useAppDocumentState } from '../app/useAppDocumentState';
import type { useAppRefs } from '../app/useAppRefs';
import type { useDocumentPanelsState } from '../app/useDocumentPanelsState';
import type { useDrawingGesture } from '../viewer/useDrawingGesture';
import type { useHelpChromeState } from '../app/useHelpChromeState';
import type { buildAppMenus } from '../menu/buildAppMenus';
import type { BuildAppModalCtxSourceInput } from '../modals/buildAppModalCtxSource';
import type { BuildAppChromeSourceInput } from './buildAppChromeSource';
import type { BuildAppViewerSourceInput } from '../viewer/buildAppViewerSource';

type DocumentState = ReturnType<typeof useAppDocumentState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type DrawingState = ReturnType<typeof useDrawingGesture>;
type HelpState = ReturnType<typeof useHelpChromeState>;
type RefsState = ReturnType<typeof useAppRefs>;
type AppMenus = ReturnType<typeof buildAppMenus>;

export type BuildAppShellRenderInputArgs = {
  doc: DocumentState;
  modal: { pageSizes: BuildAppChromeSourceInput['pageSizes'] };
  panels: PanelsState;
  annotation: AnnotationState;
  drawing: Pick<DrawingState, 'highlightStart' | 'highlightRect' | 'inkDraft' | 'shapeLineEnd' | 'drawing'>;
  help: HelpState;
  refs: Pick<RefsState, 'imgRef'>;
  pdfActions: AppPdfActions;
  windowTitle: string;
  appMenus: AppMenus;
  modeExtras: BuildAppChromeSourceInput['modeExtras'];
  modalCtx: BuildAppModalCtxSourceInput;
  printPages: string[];
  viewer: Pick<
    BuildAppViewerSourceInput,
    | 'thumbnails'
    | 'imageSrc'
    | 'annotations'
    | 'scrollRef'
    | 'handleWheel'
    | 'handleImageLoad'
    | 'handleDragStart'
    | 'handleDragOver'
    | 'handleDrop'
    | 'goToPage'
    | 'openPdf'
    | 'loadPdfBookmarks'
    | 'loadPdfSignatures'
    | 'activeSearchRect'
  > & {
    commitPage: () => void;
    commitZoom: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
  };
};

export function buildAppShellRenderInput(args: BuildAppShellRenderInputArgs) {
  const pageZoom = buildAppShellPageZoomInput({
    doc: args.doc,
    modal: args.modal,
    viewer: args.viewer,
  });

  return buildAppShellSource({
    windowTitle: args.windowTitle,
    toast: args.doc.toast,
    loading: args.doc.loading,
    chrome: buildAppShellChromeInput({
      menus: args.appMenus,
      help: buildHelpChromeInput(args.help),
      modeExtras: args.modeExtras,
      ...pageZoom,
    }),
    viewer: buildAppShellViewerInput({
      document: {
        filePath: args.doc.filePath,
        viewMode: args.doc.viewMode,
        zoom: args.doc.zoom,
        markdownOcrNotice: args.doc.markdownOcrNotice,
        markdownPath: args.doc.markdownPath,
        markdownText: args.doc.markdownText,
      },
      sidebar: {
        thumbnails: args.viewer.thumbnails,
        currentPage: args.doc.currentPage,
        draggedIndex: args.doc.draggedIndex,
        handleDragStart: args.viewer.handleDragStart,
        handleDragOver: args.viewer.handleDragOver,
        handleDrop: args.viewer.handleDrop,
        goToPage: args.viewer.goToPage,
        showBookmarksPanel: args.panels.showBookmarksPanel,
        pdfBookmarks: args.panels.pdfBookmarks,
        openAddBookmarkModal: args.pdfActions.openAddBookmarkModal,
        openBookmarkAllModal: args.pdfActions.openBookmarkAllModal,
        handleClearAllBookmarks: args.pdfActions.handleClearAllBookmarks,
        loadPdfBookmarks: args.viewer.loadPdfBookmarks,
        openRenameBookmarkModal: args.pdfActions.openRenameBookmarkModal,
        handleRemoveBookmark: args.pdfActions.handleRemoveBookmark,
        showSignaturesPanel: args.panels.showSignaturesPanel,
        pdfSignatures: args.panels.pdfSignatures,
        signatureVerification: args.panels.signatureVerification,
        loadPdfSignatures: args.viewer.loadPdfSignatures,
        showFormsPanel: args.panels.showFormsPanel,
        formFields: args.panels.formFields,
        formDrafts: args.panels.formDrafts,
        setFormDrafts: args.panels.setFormDrafts,
        openAddFormFieldModal: args.pdfActions.openAddFormFieldModal,
        applyFormField: args.pdfActions.applyFormField,
      },
      viewer: {
        scrollRef: args.viewer.scrollRef,
        handleWheel: args.viewer.handleWheel,
        openPdf: args.viewer.openPdf,
        openMarkdownSaveAs: args.pdfActions.openMarkdownSaveAs,
        imageSrc: args.viewer.imageSrc,
        imgRef: args.refs.imgRef,
        handleImageLoad: args.viewer.handleImageLoad,
        activeSearchRect: args.viewer.activeSearchRect,
        annotations: args.viewer.annotations,
      },
      modes: {
        highlightMode: args.annotation.highlightMode,
        noteMode: args.annotation.noteMode,
        drawMode: args.annotation.drawMode,
        shapeMode: args.annotation.shapeMode,
        stampMode: args.annotation.stampMode,
        redactMode: args.annotation.redactMode,
        imageInsertMode: args.annotation.imageInsertMode,
        textEditMode: args.annotation.textEditMode,
        vectorEditMode: args.annotation.vectorEditMode,
        formAddMode: args.annotation.formAddMode,
        shapeKind: args.annotation.shapeKind,
        drawing: args.drawing.drawing,
        highlightStart: args.drawing.highlightStart,
        highlightRect: args.drawing.highlightRect,
        shapeLineEnd: args.drawing.shapeLineEnd,
        inkDraft: args.drawing.inkDraft,
        pageTextEdits: args.annotation.pageTextEdits,
        pageVectorEdits: args.annotation.pageVectorEdits,
      },
      interaction: {
        handlePageClick: args.pdfActions.handlePageClick,
        handleDrawMouseDown: args.pdfActions.handleDrawMouseDown,
        handlePageMouseMove: args.pdfActions.handlePageMouseMove,
        handleDrawMouseUp: args.pdfActions.handleDrawMouseUp,
        removeHighlight: args.pdfActions.removeHighlight,
        removeRedaction: args.pdfActions.removeRedaction,
        removeStamp: args.pdfActions.removeStamp,
        removeShape: args.pdfActions.removeShape,
        removeInkStroke: args.pdfActions.removeInkStroke,
        removeTextNote: args.pdfActions.removeTextNote,
      },
    }),
    modalCtx: args.modalCtx,
    printPages: args.printPages,
  });
}
