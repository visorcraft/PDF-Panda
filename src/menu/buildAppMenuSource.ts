import type { AppMenuContextSource } from './types';
import type { ScrollViewMode, ViewMode } from '../app/types';

/** Inputs from App hooks/state before menu void-wrapping in buildAppMenuContext. */
export type BuildAppMenuSourceInput = Omit<
  AppMenuContextSource,
  | 'hasPdf'
  | 'tesseractInstalled'
  | 'requestClosePdf'
  | 'setViewModePdf'
  | 'toggleBookmarksPanel'
  | 'toggleAnnotationsPanel'
  | 'toggleContinuousScroll'
  | 'openPageEditsModal'
  | 'openShortcutsHelp'
  | 'openLicenses'
  | 'openCredits'
  | 'openAbout'
  | 'openUpdateModal'
  | 'openCommandPalette'
> & {
  filePath: string;
  ocrAvailable: boolean | null;
  guardUnsaved: (action: () => void) => void;
  closePdf: () => void;
  setViewMode: (mode: ViewMode) => void;
  scrollViewMode: ScrollViewMode;
  setScrollViewMode: (fn: (prev: ScrollViewMode) => ScrollViewMode) => void;
  setShowBookmarksPanel: (fn: (prev: boolean) => boolean) => void;
  setShowAnnotationsPanel: (fn: (prev: boolean) => boolean) => void;
  setShowPageEditsModal: (open: boolean) => void;
  setShowShortcutsHelp: (open: boolean) => void;
  setShowLicenses: (open: boolean) => void;
  setShowCredits: (open: boolean) => void;
  setShowAbout: (open: boolean) => void;
  setShowUpdateModal: (open: boolean) => void;
  updaterSupported: boolean;
  setShowCommandPalette: (open: boolean) => void;
};

export function buildAppMenuSource(input: BuildAppMenuSourceInput): AppMenuContextSource {
  const {
    filePath,
    ocrAvailable,
    guardUnsaved,
    closePdf,
    setViewMode,
    scrollViewMode,
    setScrollViewMode,
    setShowBookmarksPanel,
    setShowAnnotationsPanel,
    setShowPageEditsModal,
    setShowShortcutsHelp,
    setShowLicenses,
    setShowCredits,
    setShowAbout,
    setShowUpdateModal,
    updaterSupported,
    setShowCommandPalette,
    ...passthrough
  } = input;
  return {
    ...passthrough,
    updaterSupported,
    hasPdf: !!filePath,
    tesseractInstalled: ocrAvailable === true,
    requestClosePdf: () => guardUnsaved(closePdf),
    setViewModePdf: () => setViewMode('pdf'),
    scrollViewMode,
    toggleContinuousScroll: () => setScrollViewMode((prev) => (prev === 'continuous' ? 'single' : 'continuous')),
    toggleBookmarksPanel: () => setShowBookmarksPanel((prev) => !prev),
    toggleAnnotationsPanel: () => setShowAnnotationsPanel((prev) => !prev),
    openPageEditsModal: () => setShowPageEditsModal(true),
    openShortcutsHelp: () => setShowShortcutsHelp(true),
    openLicenses: () => setShowLicenses(true),
    openCredits: () => setShowCredits(true),
    openAbout: () => setShowAbout(true),
    openUpdateModal: () => setShowUpdateModal(true),
    openCommandPalette: () => setShowCommandPalette(true),
  };
}
