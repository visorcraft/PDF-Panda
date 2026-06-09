import type { useAppDocumentState } from '../app/useAppDocumentState';
import type { BuildAppShellChromeInputArgs } from './buildAppShellChromeInput';

type DocumentState = ReturnType<typeof useAppDocumentState>;

export type BuildAppShellPageZoomInputArgs = {
  doc: Pick<
    DocumentState,
    'pageCount' | 'viewMode' | 'currentPage' | 'pageInput' | 'zoom' | 'zoomInput' | 'setPageInput' | 'setZoomInput'
  >;
  modal: { pageSizes: BuildAppShellChromeInputArgs['page']['pageSizes'] };
  viewer: {
    commitPage: BuildAppShellChromeInputArgs['page']['commitPage'];
    goToPage: BuildAppShellChromeInputArgs['page']['goToPage'];
    commitZoom: BuildAppShellChromeInputArgs['zoom']['commitZoom'];
    zoomIn: BuildAppShellChromeInputArgs['zoom']['zoomIn'];
    zoomOut: BuildAppShellChromeInputArgs['zoom']['zoomOut'];
    resetZoom: BuildAppShellChromeInputArgs['zoom']['resetZoom'];
  };
};

export function buildAppShellPageZoomInput(args: BuildAppShellPageZoomInputArgs) {
  return {
    page: {
      pageCount: args.doc.pageCount,
      viewMode: args.doc.viewMode,
      currentPage: args.doc.currentPage,
      pageInput: args.doc.pageInput,
      pageSizes: args.modal.pageSizes,
      setPageInput: args.doc.setPageInput,
      commitPage: args.viewer.commitPage,
      goToPage: args.viewer.goToPage,
    },
    zoom: {
      zoom: args.doc.zoom,
      zoomInput: args.doc.zoomInput,
      setZoomInput: args.doc.setZoomInput,
      commitZoom: args.viewer.commitZoom,
      zoomIn: args.viewer.zoomIn,
      zoomOut: args.viewer.zoomOut,
      resetZoom: args.viewer.resetZoom,
    },
  };
}
