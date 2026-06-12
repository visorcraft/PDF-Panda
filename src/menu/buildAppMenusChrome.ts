import type { AppMenuContext, MenuAction, MenuRoot } from './types';
import { act, sep } from './menuBuilders';
import { APPEARANCE_OPTIONS } from '../settings/appearancePalettes';

export function buildViewMenu(ctx: AppMenuContext): MenuRoot {
  const pdfItems = [
    act('view-pdf', 'PDF view', ctx.setViewModePdf, { active: ctx.viewMode === 'pdf' }),
    act('view-md', 'Markdown view', () => void ctx.toggleMarkdownView(), {
      shortcutCommandId: 'markdown-view',
      active: ctx.viewMode === 'markdown',
    }),
    sep(),
    act(
      'continuous-scroll',
      ctx.scrollViewMode === 'continuous' ? 'Continuous scroll (on)' : 'Continuous scroll',
      ctx.toggleContinuousScroll,
      { active: ctx.scrollViewMode === 'continuous', disabled: ctx.viewMode !== 'pdf' },
    ),
    act('bookmarks', ctx.showBookmarksPanel ? 'Bookmarks panel (on)' : 'Bookmarks panel', ctx.toggleBookmarksPanel, {
      active: ctx.showBookmarksPanel,
    }),
    act(
      'annotations-panel',
      ctx.showAnnotationsPanel ? 'Annotations panel (on)' : 'Annotations panel',
      ctx.toggleAnnotationsPanel,
      { active: ctx.showAnnotationsPanel },
    ),
    act(
      'pdfua-panel',
      ctx.showPdfUaPanel ? 'PDF/UA Check (on)' : 'PDF/UA Check',
      ctx.togglePdfUaPanel,
      { active: ctx.showPdfUaPanel },
    ),
    sep(),
  ];
  const themeItems = APPEARANCE_OPTIONS.map((option) =>
    act(`theme-${option.key}`, option.label, () => ctx.setTheme(option.key), { active: ctx.theme === option.key }),
  );
  return {
    id: 'view',
    label: 'View',
    items: ctx.hasPdf ? [...pdfItems, ...themeItems] : themeItems,
  };
}

export function buildHelpMenu(ctx: AppMenuContext): MenuRoot {
  return {
    id: 'help',
    label: 'Help',
    items: [
      act('cmd-palette', 'Command palette…', ctx.openCommandPalette, { shortcutCommandId: 'command-palette' }),
      ...(ctx.tesseractInstalled
        ? []
        : [act('tesseract', 'Install Tesseract (scan OCR)…', ctx.openTesseractGuide)]),
      act('settings', 'Settings…', () => ctx.openSettings(null)),
      act('shortcuts', 'Keyboard shortcuts…', () => ctx.openSettings('shortcuts')),
      act('licenses', 'Licenses…', ctx.openLicenses),
      act('credits', 'Credits…', ctx.openCredits),
      act('about', 'About PDF Panda…', ctx.openAbout),
      act('check-updates', 'Check for Updates…', ctx.openUpdateModal),
    ],
  };
}

export function buildQuickAccessActions(ctx: AppMenuContext): MenuAction[] {
  return ctx.hasPdf
    ? [
        act('qa-save', ctx.isDirty ? 'Save •' : 'Save', ctx.handleSave, {
          shortcutCommandId: 'save',
          disabled: !ctx.isDirty,
        }),
        act('qa-undo', 'Undo', ctx.undo, { shortcutCommandId: 'undo', disabled: !ctx.canUndo }),
        act('qa-redo', 'Redo', ctx.redo, { shortcutCommandId: 'redo', disabled: !ctx.canRedo }),
        act('qa-find', 'Find', ctx.openSearchModal, { shortcutCommandId: 'find' }),
        act('qa-highlight', 'Highlight', ctx.toggleHighlightMode, {
          shortcutCommandId: 'toggle-highlight',
          active: ctx.highlightMode,
        }),
        act('qa-note', 'Note', ctx.toggleNoteMode, { shortcutCommandId: 'toggle-note', active: ctx.noteMode }),
        act('qa-draw', 'Draw', ctx.toggleDrawMode, { shortcutCommandId: 'toggle-draw', active: ctx.drawMode }),
        act('qa-rotate', 'Rotate', ctx.openRotateModal, { shortcutCommandId: 'rotate-page' }),
        act('qa-dup', 'Duplicate', ctx.handleDuplicatePage, { shortcutCommandId: 'duplicate-page' }),
      ]
    : [];
}
