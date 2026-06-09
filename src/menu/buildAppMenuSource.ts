import type { AppMenuContextSource } from './types';
import type { ViewMode } from '../app/types';

/** Inputs from App hooks/state before menu void-wrapping in buildAppMenuContext. */
export type BuildAppMenuSourceInput = Omit<
  AppMenuContextSource,
  | 'hasPdf'
  | 'tesseractInstalled'
  | 'requestClosePdf'
  | 'setViewModePdf'
  | 'toggleBookmarksPanel'
  | 'openPageEditsModal'
  | 'openShortcutsHelp'
  | 'openLicenses'
  | 'openCredits'
  | 'openAbout'
  | 'openCommandPalette'
> & {
  filePath: string;
  ocrAvailable: boolean | null;
  guardUnsaved: (action: () => void) => void;
  closePdf: () => void;
  setViewMode: (mode: ViewMode) => void;
  setShowBookmarksPanel: (fn: (prev: boolean) => boolean) => void;
  setShowPageEditsModal: (open: boolean) => void;
  setShowShortcutsHelp: (open: boolean) => void;
  setShowLicenses: (open: boolean) => void;
  setShowCredits: (open: boolean) => void;
  setShowAbout: (open: boolean) => void;
  setShowCommandPalette: (open: boolean) => void;
};

export function buildAppMenuSource(input: BuildAppMenuSourceInput): AppMenuContextSource {
  const {
    filePath,
    ocrAvailable,
    guardUnsaved,
    closePdf,
    setViewMode,
    setShowBookmarksPanel,
    setShowPageEditsModal,
    setShowShortcutsHelp,
    setShowLicenses,
    setShowCredits,
    setShowAbout,
    setShowCommandPalette,
    ...passthrough
  } = input;
  return {
    ...passthrough,
    hasPdf: !!filePath,
    tesseractInstalled: ocrAvailable === true,
    requestClosePdf: () => guardUnsaved(closePdf),
    setViewModePdf: () => setViewMode('pdf'),
    toggleBookmarksPanel: () => setShowBookmarksPanel((prev) => !prev),
    openPageEditsModal: () => setShowPageEditsModal(true),
    openShortcutsHelp: () => setShowShortcutsHelp(true),
    openLicenses: () => setShowLicenses(true),
    openCredits: () => setShowCredits(true),
    openAbout: () => setShowAbout(true),
    openCommandPalette: () => setShowCommandPalette(true),
  };
}
