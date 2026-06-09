import type { BuildAppChromeSourceInput } from './buildAppChromeSource';
import type { AppMenus } from '../menu/types';

export type BuildAppShellChromeInputArgs = {
  menus: AppMenus;
  help: {
    showCommandPalette: boolean;
    showShortcutsHelp: boolean;
    showLicenses: boolean;
    showCredits: boolean;
    showAbout: boolean;
    setShowCommandPalette: (open: boolean) => void;
    setShowShortcutsHelp: (open: boolean) => void;
    setShowLicenses: (open: boolean) => void;
    setShowCredits: (open: boolean) => void;
    setShowAbout: (open: boolean) => void;
  };
  modeExtras: BuildAppChromeSourceInput['modeExtras'];
  page: {
    pageCount: number | null;
    viewMode: BuildAppChromeSourceInput['viewMode'];
    currentPage: number;
    pageInput: string;
    pageSizes: BuildAppChromeSourceInput['pageSizes'];
    setPageInput: (value: string) => void;
    commitPage: () => void;
    goToPage: (page: number) => void;
  };
  zoom: {
    zoom: number;
    zoomInput: string;
    setZoomInput: (value: string) => void;
    commitZoom: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
  };
};

export function buildAppShellChromeInput(args: BuildAppShellChromeInputArgs): BuildAppChromeSourceInput {
  return {
    menus: args.menus,
    ...args.help,
    modeExtras: args.modeExtras,
    pageCount: args.page.pageCount,
    viewMode: args.page.viewMode,
    currentPage: args.page.currentPage,
    pageInput: args.page.pageInput,
    pageSizes: args.page.pageSizes,
    setPageInput: args.page.setPageInput,
    commitPage: args.page.commitPage,
    goToPage: args.page.goToPage,
    zoom: args.zoom.zoom,
    zoomInput: args.zoom.zoomInput,
    setZoomInput: args.zoom.setZoomInput,
    commitZoom: args.zoom.commitZoom,
    zoomIn: args.zoom.zoomIn,
    zoomOut: args.zoom.zoomOut,
    resetZoom: args.zoom.resetZoom,
  };
}
