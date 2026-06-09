import type { AppMenuContext, MenuRoot } from './types';
import { act, sep } from './menuBuilders';

export function buildAnnotMenu(ctx: AppMenuContext): MenuRoot {
  return {
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
}

export function buildSecurityMenu(ctx: AppMenuContext): MenuRoot {
  return {
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
}
