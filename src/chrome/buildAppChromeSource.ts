import type { BuildChromeContextInput } from './buildChromeContext';
import type { AppMenus } from '../menu/types';
import type { ComponentProps } from 'react';
import type { PageControls } from '../viewer/PageControls';

export type BuildAppChromeSourceInput = {
  menus: AppMenus;
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
  modeExtras: BuildChromeContextInput['modeExtras'];
  pageCount: number | null;
  viewMode: 'pdf' | 'markdown';
  currentPage: number;
  pageInput: string;
  pageSizes: ComponentProps<typeof PageControls>['pageSizes'];
  setPageInput: (value: string) => void;
  commitPage: () => void;
  goToPage: (page: number) => void;
  zoom: number;
  zoomInput: string;
  setZoomInput: (value: string) => void;
  commitZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
};

export function buildAppChromeSource(input: BuildAppChromeSourceInput): BuildChromeContextInput {
  const showPageControls = input.pageCount !== null && input.viewMode === 'pdf';
  return {
    menus: input.menus,
    showCommandPalette: input.showCommandPalette,
    showShortcutsHelp: input.showShortcutsHelp,
    showLicenses: input.showLicenses,
    showCredits: input.showCredits,
    showAbout: input.showAbout,
    onCloseCommandPalette: () => input.setShowCommandPalette(false),
    onCloseShortcutsHelp: () => input.setShowShortcutsHelp(false),
    onCloseLicenses: () => input.setShowLicenses(false),
    onCloseCredits: () => input.setShowCredits(false),
    onCloseAbout: () => input.setShowAbout(false),
    modeExtras: input.modeExtras,
    showPageControls,
    pageControls: showPageControls ? {
      pageCount: input.pageCount!,
      currentPage: input.currentPage,
      pageInput: input.pageInput,
      pageSizes: input.pageSizes,
      onPageInputChange: input.setPageInput,
      onCommitPage: input.commitPage,
      onGoToPage: input.goToPage,
      zoom: input.zoom,
      zoomInput: input.zoomInput,
      onZoomInputChange: input.setZoomInput,
      onCommitZoom: input.commitZoom,
      onZoomIn: input.zoomIn,
      onZoomOut: input.zoomOut,
      onResetZoom: input.resetZoom,
    } : null,
  };
}
