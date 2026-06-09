import type { BuildAppViewerSourceInput } from './buildAppViewerSource';

export type BuildAppShellViewerInputArgs = {
  document: Pick<
    BuildAppViewerSourceInput,
    'filePath' | 'viewMode' | 'zoom' | 'markdownOcrNotice' | 'markdownPath' | 'markdownText'
  >;
  sidebar: Pick<
    BuildAppViewerSourceInput,
    | 'thumbnails'
    | 'currentPage'
    | 'draggedIndex'
    | 'handleDragStart'
    | 'handleDragOver'
    | 'handleDrop'
    | 'goToPage'
    | 'showBookmarksPanel'
    | 'pdfBookmarks'
    | 'openAddBookmarkModal'
    | 'openBookmarkAllModal'
    | 'handleClearAllBookmarks'
    | 'loadPdfBookmarks'
    | 'openRenameBookmarkModal'
    | 'handleRemoveBookmark'
    | 'showSignaturesPanel'
    | 'pdfSignatures'
    | 'signatureVerification'
    | 'loadPdfSignatures'
    | 'showFormsPanel'
    | 'formFields'
    | 'formDrafts'
    | 'setFormDrafts'
    | 'openAddFormFieldModal'
    | 'applyFormField'
  >;
  viewer: Pick<
    BuildAppViewerSourceInput,
    | 'scrollRef'
    | 'handleWheel'
    | 'openPdf'
    | 'openMarkdownSaveAs'
    | 'imageSrc'
    | 'imgRef'
    | 'handleImageLoad'
    | 'activeSearchRect'
    | 'annotations'
  >;
  modes: Pick<
    BuildAppViewerSourceInput,
    | 'highlightMode'
    | 'noteMode'
    | 'drawMode'
    | 'shapeMode'
    | 'stampMode'
    | 'redactMode'
    | 'imageInsertMode'
    | 'textEditMode'
    | 'vectorEditMode'
    | 'formAddMode'
    | 'shapeKind'
    | 'drawing'
    | 'highlightStart'
    | 'highlightRect'
    | 'shapeLineEnd'
    | 'inkDraft'
    | 'pageTextEdits'
    | 'pageVectorEdits'
  >;
  interaction: Pick<
    BuildAppViewerSourceInput,
    | 'handlePageClick'
    | 'handleDrawMouseDown'
    | 'handlePageMouseMove'
    | 'handleDrawMouseUp'
    | 'removeHighlight'
    | 'removeRedaction'
    | 'removeStamp'
    | 'removeShape'
    | 'removeInkStroke'
    | 'removeTextNote'
  >;
};

export function buildAppShellViewerInput(args: BuildAppShellViewerInputArgs): BuildAppViewerSourceInput {
  return {
    ...args.document,
    ...args.sidebar,
    ...args.viewer,
    ...args.modes,
    ...args.interaction,
  };
}
