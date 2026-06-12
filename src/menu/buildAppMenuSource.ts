import type { AppMenuContextSource } from './types';
import type { ScrollViewMode, ViewMode } from '../app/types';
import type { AppSurface, SettingsFocusSection } from '../app/useAppSurfaceState';
import type { AppearanceKey } from '../settings/appearancePalettes';
import type { ShortcutBindings } from '../app/useShortcutBindingsState';

/** Inputs from App hooks/state before menu void-wrapping in buildAppMenuContext. */
export type BuildAppMenuSourceInput = Omit<
  AppMenuContextSource,
  | 'hasPdf'
  | 'tesseractInstalled'
  | 'requestClosePdf'
  | 'setViewModePdf'
  | 'toggleBookmarksPanel'
  | 'toggleAnnotationsPanel'
  | 'togglePdfUaPanel'
  | 'toggleContinuousScroll'
  | 'openPageEditsModal'
  | 'openShortcutsHelp'
  | 'openLicenses'
  | 'openCredits'
  | 'openAbout'
  | 'openUpdateModal'
  | 'openCommandPalette'
  | 'activeSurface'
  | 'openSettings'
  | 'shortcutBindings'
> & {
  filePath: string;
  ocrAvailable: boolean | null;
  surface: { activeSurface: AppSurface; openSettings: (focus?: SettingsFocusSection) => void };
  guardUnsaved: (action: () => void) => void;
  closePdf: () => void;
  setViewMode: (mode: ViewMode) => void;
  scrollViewMode: ScrollViewMode;
  setScrollViewMode: (fn: (prev: ScrollViewMode) => ScrollViewMode) => void;
  setShowBookmarksPanel: (fn: (prev: boolean) => boolean) => void;
  setShowAnnotationsPanel: (fn: (prev: boolean) => boolean) => void;
  setShowPdfUaPanel: (fn: (prev: boolean) => boolean) => void;
  setShowPageEditsModal: (open: boolean) => void;
  setShowShortcutsHelp: (open: boolean) => void;
  setShowLicenses: (open: boolean) => void;
  setShowCredits: (open: boolean) => void;
  setShowAbout: (open: boolean) => void;
  setShowUpdateModal: (open: boolean) => void;
  updaterSupported: boolean;
  setShowCommandPalette: (open: boolean) => void;
  theme: AppearanceKey;
  setTheme: (theme: AppearanceKey) => void;
  shortcutBindings: ShortcutBindings;
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
    setShowPdfUaPanel,
    setShowPageEditsModal,
    setShowShortcutsHelp,
    setShowLicenses,
    setShowCredits,
    setShowAbout,
    setShowUpdateModal,
    updaterSupported,
    setShowCommandPalette,
    theme,
    setTheme,
    surface,
    shortcutBindings,
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
    togglePdfUaPanel: () => setShowPdfUaPanel((prev) => !prev),
    openPageEditsModal: () => setShowPageEditsModal(true),
    openShortcutsHelp: () => setShowShortcutsHelp(true),
    openLicenses: () => setShowLicenses(true),
    openCredits: () => setShowCredits(true),
    openAbout: () => setShowAbout(true),
    openUpdateModal: () => setShowUpdateModal(true),
    openCommandPalette: () => setShowCommandPalette(true),
    theme,
    setTheme,
    activeSurface: surface.activeSurface,
    openSettings: (focus?: SettingsFocusSection) => surface.openSettings(focus),
    shortcutBindings,
  };
}
