import type { AppMenuContext, MenuAction, MenuRoot } from './types';
import { act, sep } from './menuBuilders';

export function buildViewMenu(ctx: AppMenuContext): MenuRoot {
  return {
    id: 'view',
    label: 'View',
    disabled: !ctx.hasPdf,
    items: [
      act('view-pdf', 'PDF view', ctx.setViewModePdf, { active: ctx.viewMode === 'pdf' }),
      act('view-md', 'Markdown view', () => void ctx.toggleMarkdownView(), {
        shortcut: 'Ctrl+Shift+M',
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
    ],
  };
}

export function buildHelpMenu(ctx: AppMenuContext): MenuRoot {
  return {
    id: 'help',
    label: 'Help',
    items: [
      act('cmd-palette', 'Command palette…', ctx.openCommandPalette, { shortcut: 'Ctrl+Shift+P' }),
      ...(ctx.tesseractInstalled
        ? []
        : [act('tesseract', 'Install Tesseract (scan OCR)…', ctx.openTesseractGuide)]),
      act('shortcuts', 'Keyboard shortcuts…', ctx.openShortcutsHelp),
      act('licenses', 'Licenses…', ctx.openLicenses),
      act('credits', 'Credits…', ctx.openCredits),
      act('about', 'About PDF Panda…', ctx.openAbout),
      ...(ctx.updaterSupported
        ? [act('check-updates', 'Check for Updates…', ctx.openUpdateModal)]
        : []),
    ],
  };
}

export function buildQuickAccessActions(ctx: AppMenuContext): MenuAction[] {
  return ctx.hasPdf
    ? [
        act('qa-save', ctx.isDirty ? 'Save •' : 'Save', ctx.handleSave, {
          shortcut: 'Ctrl+S',
          disabled: !ctx.isDirty,
        }),
        act('qa-undo', 'Undo', ctx.undo, { shortcut: 'Ctrl+Z', disabled: !ctx.canUndo }),
        act('qa-redo', 'Redo', ctx.redo, { shortcut: 'Ctrl+Y', disabled: !ctx.canRedo }),
        act('qa-find', 'Find', ctx.openSearchModal, { shortcut: 'Ctrl+F' }),
        act('qa-highlight', 'Highlight', ctx.toggleHighlightMode, {
          shortcut: 'H',
          active: ctx.highlightMode,
        }),
        act('qa-note', 'Note', ctx.toggleNoteMode, { shortcut: 'N', active: ctx.noteMode }),
        act('qa-draw', 'Draw', ctx.toggleDrawMode, { shortcut: 'D', active: ctx.drawMode }),
        act('qa-rotate', 'Rotate', ctx.handleRotatePage, { shortcut: 'Ctrl+R' }),
        act('qa-dup', 'Duplicate', ctx.handleDuplicatePage, { shortcut: 'Ctrl+Shift+D' }),
      ]
    : [];
}
