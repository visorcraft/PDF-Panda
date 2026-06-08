import type { AppMenuContext, AppMenus, FlatMenuAction, MenuAction, MenuEntry, MenuRoot } from './types';

const sep = (): MenuEntry => ({ separator: true });

const act = (
  id: string,
  label: string,
  run: () => void,
  opts?: Partial<Pick<MenuAction, 'shortcut' | 'disabled' | 'danger' | 'active'>>,
): MenuAction => ({ id, label, run, ...opts });

const sub = (label: string, items: MenuEntry[]): MenuEntry => ({ label, items });

const multiPage = (pageCount: number | null) => pageCount !== null && pageCount >= 2;
const canDeletePage = (pageCount: number | null) => pageCount !== null && pageCount > 1;

export function buildAppMenus(ctx: AppMenuContext): AppMenus {
  const { pageCount, currentPage } = ctx;
  const mp = multiPage(pageCount);
  const del = canDeletePage(pageCount);
  const atFirst = currentPage === 0;
  const atLast = pageCount !== null && currentPage >= pageCount - 1;

  const fileMenu: MenuRoot = {
    id: 'file',
    label: 'File',
    items: [
      act('open', 'Open PDF…', ctx.openPdf, { shortcut: 'Ctrl+O' }),
      ...(ctx.hasPdf
        ? [
            sep(),
            act('save', ctx.isDirty ? 'Save' : 'Save', ctx.handleSave, {
              shortcut: 'Ctrl+S',
              disabled: !ctx.isDirty,
            }),
            act('save-as', 'Save As…', ctx.openSaveAs, { shortcut: 'Ctrl+Shift+S' }),
            sep(),
            act('print', 'Print…', ctx.handlePrint, { shortcut: 'Ctrl+P' }),
            sub('Export', [
              act('export-image', 'Pages as images…', ctx.openExportPngModal, { shortcut: 'Ctrl+Shift+B' }),
              act('export-page', 'Current page as PDF…', ctx.openExportPagePdfModal),
              act('export-pages', 'Each page as PDF…', ctx.openExportPagesPdfModal),
            ]),
            sep(),
            act('protect', 'Export password-protected copy…', ctx.openProtectModal),
            act('decrypt', 'Save decrypted copy…', ctx.openDecryptModal),
            sep(),
            act('close', 'Close', ctx.requestClosePdf, { shortcut: 'Ctrl+W' }),
          ]
        : []),
    ],
  };

  const editMenu: MenuRoot = {
    id: 'edit',
    label: 'Edit',
    disabled: !ctx.hasPdf,
    items: [
      act('undo', 'Undo', ctx.undo, { shortcut: 'Ctrl+Z', disabled: !ctx.canUndo }),
      act('redo', 'Redo', ctx.redo, { shortcut: 'Ctrl+Y', disabled: !ctx.canRedo }),
      sep(),
      act('find', 'Find text…', ctx.openSearchModal, { shortcut: 'Ctrl+F' }),
    ],
  };

  const pagesMenu: MenuRoot = {
    id: 'pages',
    label: 'Pages',
    disabled: !ctx.hasPdf,
    items: [
      sub('Rotate', [
        act('rot-cw', 'Current page 90° clockwise', ctx.handleRotatePage, { shortcut: 'Ctrl+R' }),
        act('rot-ccw', 'Current page 90° counter-clockwise', ctx.handleRotatePageCcw),
        act('rot-180', 'Current page 180°', ctx.handleRotatePage180),
        act('rot-reset', 'Reset current page rotation', ctx.handleResetPageRotation),
        sep(),
        act('rot-all', 'All pages 90° clockwise', ctx.handleRotateAllPages),
        act('rot-all-ccw', 'All pages 90° counter-clockwise', ctx.handleRotateAllPagesCcw),
        act('rot-all-180', 'All pages 180°', ctx.handleRotateAllPages180),
        act('rot-reset-all', 'Reset all page rotations', ctx.handleResetAllRotations),
        sep(),
        sub('Odd pages', [
          act('rot-odd', '90° clockwise', ctx.handleRotateOddPages),
          act('rot-odd-ccw', '90° counter-clockwise', ctx.handleRotateOddPagesCcw),
          act('rot-odd-180', '180°', ctx.handleRotate180OddPages),
          act('rot-odd-reset', 'Reset rotation', ctx.handleResetRotationOddPages),
        ]),
        sub('Even pages', [
          act('rot-even', '90° clockwise', ctx.handleRotateEvenPages),
          act('rot-even-ccw', '90° counter-clockwise', ctx.handleRotateEvenPagesCcw),
          act('rot-even-180', '180°', ctx.handleRotate180EvenPages),
          act('rot-even-reset', 'Reset rotation', ctx.handleResetRotationEvenPages),
        ]),
        sep(),
        act('rot-range', 'Page range…', ctx.openRotateRangeModal),
      ]),
      sub('Duplicate', [
        act('dup', 'Duplicate current page', ctx.handleDuplicatePage, { shortcut: 'Ctrl+Shift+D' }),
        act('dup-before', 'Duplicate before current page', ctx.handleDuplicatePageBefore),
        act('dup-range', 'Duplicate page range…', ctx.openDuplicateRangeModal),
        act('dup-all', 'Duplicate all pages (append)', ctx.handleDuplicateAllPages),
        act('dup-end', 'Duplicate current page to end', ctx.handleDuplicatePageToEnd),
        sep(),
        sub('Odd pages', [
          act('dup-odd', 'Append copies of odd pages', ctx.handleDuplicateOddPages),
          act('dup-odd-before', 'Insert copy before each odd page', ctx.handleDuplicateOddPagesBefore),
          act('dup-odd-end', 'Copy each odd page to end', ctx.handleDuplicateOddPagesToEnd),
          act('dup-odd-start', 'Copy each odd page to start', ctx.handleDuplicateOddPagesToStart),
        ]),
        sub('Even pages', [
          act('dup-even', 'Append copies of even pages', ctx.handleDuplicateEvenPages),
          act('dup-even-before', 'Insert copy before each even page', ctx.handleDuplicateEvenPagesBefore),
          act('dup-even-end', 'Copy each even page to end', ctx.handleDuplicateEvenPagesToEnd),
          act('dup-even-start', 'Copy each even page to start', ctx.handleDuplicateEvenPagesToStart),
        ]),
      ]),
      sub('Move & order', [
        act('move-up', 'Move current page up', ctx.handleMovePageUp, { disabled: atFirst }),
        act('move-down', 'Move current page down', ctx.handleMovePageDown, { disabled: atLast }),
        act('move-first', 'Move current page to first', ctx.handleMovePageToFirst, { disabled: atFirst }),
        act('move-last', 'Move current page to last', ctx.handleMovePageToLast, { disabled: atLast }),
        act('swap', 'Swap two pages…', ctx.openSwapPagesModal),
        act('move-range', 'Move page range…', ctx.openMoveRangeModal),
        sep(),
        act('reverse', 'Reverse all pages', ctx.handleReversePages, { shortcut: 'Ctrl+Shift+Y' }),
        act('reverse-range', 'Reverse page range…', ctx.openReverseRangeModal),
        act('reverse-odd', 'Reverse odd pages', ctx.handleReverseOddPages, { disabled: !mp }),
        act('reverse-even', 'Reverse even pages', ctx.handleReverseEvenPages, { disabled: !mp }),
        sep(),
        act('odd-start', 'Move odd pages to start', ctx.handleMoveOddPagesToStart, { disabled: !mp }),
        act('even-start', 'Move even pages to start', ctx.handleMoveEvenPagesToStart, { disabled: !mp }),
        act('odd-end', 'Move odd pages to end', ctx.handleMoveOddPagesToEnd, { disabled: !mp }),
        act('even-end', 'Move even pages to end', ctx.handleMoveEvenPagesToEnd, { disabled: !mp }),
      ]),
      sub('Insert', [
        act('blank-after', 'Blank page after current', ctx.handleAddBlankPage, { shortcut: 'Ctrl+Shift+N' }),
        act('blank-before', 'Blank page before current', ctx.handleAddBlankPageBefore),
        act('blank-multi', 'Multiple blank pages…', ctx.openInsertBlankPagesModal),
        act('blank-between', 'Blank page between each pair', ctx.handleInsertBlankBetweenPages, { disabled: !mp }),
        sep(),
        act('blank-before-odd', 'Blank before each odd page', ctx.handleInsertBlankBeforeOddPages),
        act('blank-before-even', 'Blank before each even page', ctx.handleInsertBlankBeforeEvenPages),
        act('blank-after-odd', 'Blank after each odd page', ctx.handleInsertBlankAfterOddPages),
        act('blank-after-even', 'Blank after each even page', ctx.handleInsertBlankAfterEvenPages),
        sep(),
        act('insert-pdf', 'Pages from another PDF…', ctx.openInsertModal, { shortcut: 'Ctrl+Shift+I' }),
        act('image-page', 'Image as new page…', ctx.openInsertImagePageModal),
      ]),
      sub('Delete', [
        act('delete', 'Delete current page', ctx.openDeleteModal, { shortcut: 'Delete', disabled: !del, danger: true }),
        act('delete-range', 'Delete page range…', ctx.openDeleteRangeModal, { disabled: !del, danger: true }),
        act('delete-nth', 'Delete every Nth page…', ctx.openDeleteNthModal, { disabled: !mp, danger: true }),
        sep(),
        act('delete-odd', 'Delete odd pages', ctx.handleDeleteOddPages, { disabled: !mp, danger: true }),
        act('delete-even', 'Delete even pages', ctx.handleDeleteEvenPages, { disabled: !mp, danger: true }),
      ]),
      sub('Split & extract', [
        act('split', 'Split into parts…', ctx.openSplitModal, { shortcut: 'Ctrl+Shift+K' }),
        act('split-at', 'Split at page…', ctx.openSplitAtModal, { disabled: !mp }),
        act('split-n', 'Split every N pages…', ctx.openSplitEveryModal),
        sep(),
        act('extract', 'Extract pages…', ctx.openExtractModal, { shortcut: 'Ctrl+Shift+J' }),
        act('extract-odd', 'Extract odd pages…', ctx.openExtractOddModal, { disabled: !mp }),
        act('extract-even', 'Extract even pages…', ctx.openExtractEvenModal, { disabled: !mp }),
        act('split-odd-even', 'Split into odd/even PDFs', ctx.handleSplitOddEven, { disabled: !mp }),
      ]),
      sub('Combine', [
        act('merge', 'Merge PDF (append)…', ctx.openMergeModal, { shortcut: 'Ctrl+Shift+G' }),
        act('prepend', 'Prepend pages…', ctx.openPrependModal),
        act('interleave', 'Interleave pages…', ctx.openInterleaveModal),
        act('replace', 'Replace current page…', ctx.openReplacePageModal),
      ]),
      sub('Keep & filter', [
        act('keep-range', 'Keep page range only…', ctx.openKeepRangeModal),
        act('keep-odd', 'Keep odd pages only', ctx.handleKeepOddPages, { disabled: !mp }),
        act('keep-even', 'Keep even pages only', ctx.handleKeepEvenPages, { disabled: !mp }),
      ]),
      sub('Sort', [
        act('sort-size-up', 'By size (smallest first)', () => void ctx.handleSortPagesBySize(false)),
        act('sort-size-down', 'By size (largest first)', () => void ctx.handleSortPagesBySize(true)),
        act('sort-rot-up', 'By rotation (0° first)', () => void ctx.handleSortPagesByRotation(false)),
        act('sort-rot-down', 'By rotation (270° first)', () => void ctx.handleSortPagesByRotation(true)),
        sep(),
        act('sort-odd-size-up', 'Odd pages by size ↑', () => void ctx.handleSortOddPagesBySize(false), { disabled: !mp }),
        act('sort-odd-size-down', 'Odd pages by size ↓', () => void ctx.handleSortOddPagesBySize(true), { disabled: !mp }),
        act('sort-even-size-up', 'Even pages by size ↑', () => void ctx.handleSortEvenPagesBySize(false), { disabled: !mp }),
        act('sort-even-size-down', 'Even pages by size ↓', () => void ctx.handleSortEvenPagesBySize(true), { disabled: !mp }),
        sep(),
        act('sort-odd-rot-up', 'Odd pages by rotation ↑', () => void ctx.handleSortOddPagesByRotation(false), { disabled: !mp }),
        act('sort-odd-rot-down', 'Odd pages by rotation ↓', () => void ctx.handleSortOddPagesByRotation(true), { disabled: !mp }),
        act('sort-even-rot-up', 'Even pages by rotation ↑', () => void ctx.handleSortEvenPagesByRotation(false), { disabled: !mp }),
        act('sort-even-rot-down', 'Even pages by rotation ↓', () => void ctx.handleSortEvenPagesByRotation(true), { disabled: !mp }),
      ]),
      sep(),
      act('parity-range', 'Parity tools for page range…', ctx.openParityRangeModal),
    ],
  };

  const documentMenu: MenuRoot = {
    id: 'document',
    label: 'Document',
    disabled: !ctx.hasPdf,
    items: [
      act('optimize', 'Optimize PDF', ctx.handleOptimizePdf, { shortcut: 'Ctrl+Shift+O' }),
      act('metadata', 'Edit metadata…', () => void ctx.openMetadataModal()),
      act('summarize', 'Summarize & extract…', ctx.handleSummarizePdf, { shortcut: 'Ctrl+Shift+E' }),
      sep(),
      act('page-numbers', 'Add page numbers…', ctx.openPageNumbersModal),
      act('page-header', 'Add page header…', ctx.openPageHeaderModal),
      act('page-footer', 'Add page footer…', ctx.openPageFooterModal),
      act('page-size', 'Set page size…', ctx.openPageSizeModal),
      act('watermark', 'Add watermark…', ctx.openWatermarkModal),
      act('border', 'Draw page border…', ctx.openPageBorderModal),
      sep(),
      sub('Crop', [
        act('crop', 'Crop current page…', ctx.openCropModal),
        act('crop-range', 'Crop page range…', ctx.openCropRangeModal),
        act('crop-odd', 'Crop odd pages', ctx.handleCropOddPages),
        act('crop-even', 'Crop even pages', ctx.handleCropEvenPages),
      ]),
      act('expand', 'Expand margins…', ctx.openExpandMarginsModal),
      act('shrink', 'Shrink margins…', ctx.openShrinkMarginsModal),
      sep(),
      sub('Flatten annotations', [
        act('flatten', 'Flatten current page…', ctx.openFlattenModal),
        act('flatten-all', 'Flatten all pages', ctx.handleFlattenAllAnnotations),
        act('flatten-odd', 'Flatten odd pages', ctx.handleFlattenOddPages),
        act('flatten-even', 'Flatten even pages', ctx.handleFlattenEvenPages),
      ]),
    ],
  };

  const annotateMenu: MenuRoot = {
    id: 'annotate',
    label: 'Annotate',
    disabled: !ctx.hasPdf,
    items: [
      act('highlight', ctx.highlightMode ? 'Highlight (on)' : 'Highlight', ctx.toggleHighlightMode, {
        shortcut: 'H',
        active: ctx.highlightMode,
      }),
      act('note', ctx.noteMode ? 'Sticky note (on)' : 'Sticky note', ctx.toggleNoteMode, {
        shortcut: 'N',
        active: ctx.noteMode,
      }),
      act('draw', ctx.drawMode ? 'Draw (on)' : 'Draw', ctx.toggleDrawMode, { shortcut: 'D', active: ctx.drawMode }),
      act('shape', ctx.shapeMode ? 'Shape (on)' : 'Shape', ctx.toggleShapeMode, {
        shortcut: 'S',
        active: ctx.shapeMode,
      }),
      act('stamp', ctx.stampMode ? 'Stamp (on)' : 'Stamp', ctx.toggleStampMode, {
        shortcut: 'T',
        active: ctx.stampMode,
      }),
      act('redact', ctx.redactMode ? 'Redact (on)' : 'Redact', ctx.toggleRedactMode, {
        shortcut: 'X',
        active: ctx.redactMode,
      }),
      sep(),
      act('insert-image', ctx.imageInsertMode ? 'Insert image (on)' : 'Insert image on page', ctx.toggleImageInsertMode, {
        shortcut: 'I',
        active: ctx.imageInsertMode,
      }),
      act('page-text', ctx.textEditMode ? 'Page text (on)' : 'Page text', ctx.toggleTextEditMode, {
        shortcut: 'E',
        active: ctx.textEditMode,
      }),
      act('vector', ctx.vectorEditMode ? 'Vector (on)' : 'Vector', ctx.toggleVectorEditMode, {
        shortcut: 'G',
        active: ctx.vectorEditMode,
      }),
      act('edits', 'Manage page edits…', ctx.openPageEditsModal),
      sep(),
      act('forms', ctx.showFormsPanel ? 'Forms panel (on)' : 'Forms panel', ctx.toggleFormsPanel, {
        shortcut: 'F',
        active: ctx.showFormsPanel,
      }),
    ],
  };

  const securityMenu: MenuRoot = {
    id: 'security',
    label: 'Security',
    disabled: !ctx.hasPdf,
    items: [
      act('sign', 'Digitally sign…', ctx.openSignModal, { shortcut: 'Ctrl+Shift+U' }),
      act('signatures', ctx.showSignaturesPanel ? 'Signatures panel (on)' : 'Signatures panel', ctx.toggleSignaturesPanel, {
        active: ctx.showSignaturesPanel,
      }),
    ],
  };

  const viewMenu: MenuRoot = {
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
      act('bookmarks', ctx.showBookmarksPanel ? 'Bookmarks panel (on)' : 'Bookmarks panel', ctx.toggleBookmarksPanel, {
        active: ctx.showBookmarksPanel,
      }),
    ],
  };

  const helpMenu: MenuRoot = {
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
    ],
  };

  const menus = [fileMenu, editMenu, pagesMenu, documentMenu, annotateMenu, securityMenu, viewMenu, helpMenu];

  const quickAccess: MenuAction[] = ctx.hasPdf
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

  const allActions = flattenMenuActions(menus);

  return { menus, quickAccess, allActions };
}

function flattenMenuActions(menus: MenuRoot[]): FlatMenuAction[] {
  const out: FlatMenuAction[] = [];
  const walk = (entries: MenuEntry[], prefix: string) => {
    for (const entry of entries) {
      if ('separator' in entry) continue;
      if ('items' in entry && !('id' in entry)) {
        walk(entry.items, prefix ? `${prefix} › ${entry.label}` : entry.label);
        continue;
      }
      const action = entry as MenuAction;
      out.push({ ...action, path: prefix ? `${prefix} › ${action.label}` : action.label });
    }
  };
  for (const menu of menus) {
    walk(menu.items, menu.label);
  }
  return out;
}

export const KEYBOARD_SHORTCUTS = [
  { keys: 'Ctrl+O', action: 'Open PDF' },
  { keys: 'Ctrl+S', action: 'Save' },
  { keys: 'Ctrl+Shift+S', action: 'Save As' },
  { keys: 'Ctrl+W', action: 'Close PDF' },
  { keys: 'Ctrl+P', action: 'Print' },
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / Redo' },
  { keys: 'Ctrl+F', action: 'Find text' },
  { keys: 'Ctrl+Shift+P', action: 'Command palette' },
  { keys: 'Ctrl+R', action: 'Rotate page' },
  { keys: 'Ctrl+Shift+D', action: 'Duplicate page' },
  { keys: 'Ctrl+Shift+N', action: 'Blank page after' },
  { keys: 'Ctrl+Shift+Y', action: 'Reverse pages' },
  { keys: 'Ctrl+Shift+I', action: 'Insert PDF' },
  { keys: 'Ctrl+Shift+G', action: 'Merge PDF' },
  { keys: 'Ctrl+Shift+K', action: 'Split PDF' },
  { keys: 'Ctrl+Shift+J', action: 'Extract pages' },
  { keys: 'Ctrl+Shift+M', action: 'Markdown view' },
  { keys: 'Ctrl+Shift+O', action: 'Optimize PDF' },
  { keys: 'Ctrl+Shift+B', action: 'Export images' },
  { keys: 'Ctrl+Shift+E', action: 'Summarize' },
  { keys: 'Ctrl+Shift+U', action: 'Sign PDF' },
  { keys: 'Delete', action: 'Delete page' },
  { keys: 'H / N / D / S / T / X', action: 'Highlight / Note / Draw / Shape / Stamp / Redact' },
  { keys: 'E / G / I / F', action: 'Page text / Vector / Insert image / Forms' },
  { keys: '← → / PageUp PageDown', action: 'Previous / next page' },
  { keys: 'Home / End', action: 'First / last page' },
  { keys: 'Ctrl + / Ctrl - / Ctrl 0', action: 'Zoom in / out / reset' },
  { keys: 'Escape', action: 'Exit tool mode or close dialog' },
] as const;
