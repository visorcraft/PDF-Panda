import type { AppMenuContext, MenuRoot } from './types';
import { act, sep, sub } from './menuBuilders';

export function buildFileEditMenus(ctx: AppMenuContext): { fileMenu: MenuRoot; editMenu: MenuRoot } {
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

  return { fileMenu, editMenu };
}
