import { useCallback } from 'react';
import type { FormFieldKind } from '../modals/AddFormFieldModal';
import type { ShapeKind, StampKind } from '../app/constants';
import type { createStructuralEditRunner } from '../pdf/runStructuralEdit';
import { getImageCoords as imageCoordsFromClick } from './getImageCoords';

type CoordFn = (clientX: number, clientY: number) => { x: number; y: number };

export type PageInteractionHandlerOptions = {
  filePath: string;
  currentPage: number;
  zoom: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  renderPage: (path: string, page: number) => Promise<void>;
  loadFormFields: (path: string) => Promise<void>;
  runEdit: ReturnType<typeof createStructuralEditRunner>;
  drawMode: boolean;
  textEditMode: boolean;
  editTextRunMode?: boolean;
  handleEditTextRunClick?: (x: number, y: number) => boolean;
  vectorEditMode: boolean;
  formAddMode: boolean;
  imageInsertMode: boolean;
  redactMode: boolean;
  stampMode: boolean;
  shapeMode: boolean;
  noteMode: boolean;
  highlightMode: boolean;
  drawing: boolean;
  highlightStart: { x: number; y: number } | null;
  inkDrawing: boolean;
  inkDraft: number[];
  shapeKind: ShapeKind;
  stampKind: StampKind;
  stampPreset: string;
  imageSourcePath: string;
  newFormFieldKind: FormFieldKind;
  newFormFieldName: string;
  newFormFieldOptions: string;
  newFormRadioGroup: string;
  newFormRadioOption: string;
  newFormCheckboxChecked: boolean;
  cancelDrawing: () => void;
  setHighlightStart: (pos: { x: number; y: number } | null) => void;
  setHighlightRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  setDrawing: (drawing: boolean) => void;
  setShapeLineEnd: (pos: { x: number; y: number } | null) => void;
  setInkDrawing: (drawing: boolean) => void;
  setInkDraft: React.Dispatch<React.SetStateAction<number[]>>;
  setPendingTextPos: (pos: { x: number; y: number } | null) => void;
  setPageTextDraft: (text: string) => void;
  setEditingTextIndex: (index: number | null) => void;
  setShowPageTextModal: (open: boolean) => void;
  setPendingNotePos: (pos: { x: number; y: number } | null) => void;
  setNoteDraft: (text: string) => void;
  setShowNoteModal: (open: boolean) => void;
  setFormAddMode: (mode: boolean) => void;
  setShowAddFormFieldModal: (open: boolean) => void;
  setNewFormFieldName: (name: string) => void;
  setNewFormRadioGroup: (group: string) => void;
  setNewFormRadioOption: (option: string) => void;
  refreshAnnotations: () => Promise<void>;
  commitInkStroke: (points: number[]) => void;
};

export function usePageInteractionHandlers(opts: PageInteractionHandlerOptions) {
  const getImageCoords: CoordFn = useCallback(
    (clientX, clientY) => imageCoordsFromClick(opts.imgRef, opts.zoom, clientX, clientY),
    [opts.imgRef, opts.zoom],
  );

  const handleDrawMouseDown = useCallback((e: React.MouseEvent) => {
    if (!opts.drawMode) return;
    e.preventDefault();
    const coords = getImageCoords(e.clientX, e.clientY);
    opts.setInkDrawing(true);
    opts.setInkDraft([coords.x, coords.y]);
  }, [opts.drawMode, getImageCoords, opts.setInkDrawing, opts.setInkDraft]);

  const handleDrawMouseUp = useCallback(() => {
    if (!opts.drawMode || !opts.inkDrawing) return;
    opts.setInkDrawing(false);
    const points = opts.inkDraft;
    opts.setInkDraft([]);
    opts.commitInkStroke(points);
  }, [opts.drawMode, opts.inkDrawing, opts.inkDraft, opts.setInkDrawing, opts.setInkDraft, opts.commitInkStroke]);

  const handlePageClick = useCallback((e: React.MouseEvent) => {
    if (opts.drawMode) return;
    if (opts.editTextRunMode && opts.handleEditTextRunClick) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (opts.handleEditTextRunClick(coords.x, coords.y)) return;
    }
    if (opts.textEditMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      opts.setPendingTextPos(coords);
      opts.setPageTextDraft('');
      opts.setEditingTextIndex(null);
      opts.setShowPageTextModal(true);
      return;
    }
    if (opts.vectorEditMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!opts.drawing) {
        opts.setHighlightStart(coords);
        opts.setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        opts.setDrawing(true);
        return;
      }
      const start = opts.highlightStart;
      opts.cancelDrawing();
      if (!start) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 4 || rect.h < 4) return;
      void opts.runEdit({
        command: 'add_page_vector_rect',
        args: { pageIndex: opts.currentPage, x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        afterEdit: async () => { await opts.renderPage(opts.filePath, opts.currentPage); },
        toast: 'Vector shape added',
      });
      return;
    }
    if (opts.formAddMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      const placeFormField = (rect: { x: number; y: number; w: number; h: number }) => {
        const base = { pageIndex: opts.currentPage, x: rect.x, y: rect.y, width: rect.w, height: rect.h };
        let command: string;
        let args: Record<string, unknown>;
        if (opts.newFormFieldKind === 'checkbox') {
          command = 'add_checkbox_form_field';
          args = { ...base, name: opts.newFormFieldName.trim(), checked: opts.newFormCheckboxChecked };
        } else if (opts.newFormFieldKind === 'choice') {
          const options = opts.newFormFieldOptions.split(',').map((o) => o.trim()).filter(Boolean);
          command = 'add_choice_form_field';
          args = { ...base, name: opts.newFormFieldName.trim(), options, combo: true };
        } else if (opts.newFormFieldKind === 'radio') {
          command = 'add_radio_form_field';
          args = { ...base, groupName: opts.newFormRadioGroup.trim(), optionName: opts.newFormRadioOption.trim() };
        } else {
          command = 'add_text_form_field';
          args = { ...base, name: opts.newFormFieldName.trim() };
        }
        void opts.runEdit({
          command,
          args,
          afterEdit: async () => {
            opts.setFormAddMode(false);
            opts.setShowAddFormFieldModal(false);
            opts.setNewFormFieldName('');
            opts.setNewFormRadioGroup('');
            opts.setNewFormRadioOption('');
            await opts.loadFormFields(opts.filePath);
          },
          toast: 'Form field added',
        });
      };

      if (opts.newFormFieldKind === 'checkbox' || opts.newFormFieldKind === 'radio') {
        const size = 18;
        placeFormField({ x: coords.x, y: coords.y, w: size, h: size });
        opts.cancelDrawing();
        return;
      }

      if (!opts.drawing) {
        opts.setHighlightStart(coords);
        opts.setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        opts.setDrawing(true);
        return;
      }
      const start = opts.highlightStart;
      opts.cancelDrawing();
      if (!start || !opts.newFormFieldName.trim()) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 20 || rect.h < 10) return;
      placeFormField(rect);
      return;
    }
    if (opts.imageInsertMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!opts.drawing) {
        opts.setHighlightStart(coords);
        opts.setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        opts.setDrawing(true);
        return;
      }
      const start = opts.highlightStart;
      opts.cancelDrawing();
      if (!start || !opts.imageSourcePath) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      void opts.runEdit({
        command: 'add_page_image',
        args: {
          pageIndex: opts.currentPage,
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          imagePath: opts.imageSourcePath,
        },
        afterEdit: async () => { await opts.renderPage(opts.filePath, opts.currentPage); },
        toast: 'Image inserted',
      });
      return;
    }
    if (opts.redactMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!opts.drawing) {
        opts.setHighlightStart(coords);
        opts.setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        opts.setDrawing(true);
        return;
      }
      const start = opts.highlightStart;
      opts.cancelDrawing();
      if (!start) return;
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      void opts.runEdit({
        command: 'add_redaction',
        args: { pageIndex: opts.currentPage, x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h },
        afterEdit: async () => { await opts.refreshAnnotations(); },
        toast: 'Redaction added',
      });
      return;
    }
    if (opts.stampMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      void opts.runEdit({
        command: opts.stampKind === 'image' ? 'add_image_stamp' : 'add_text_stamp',
        args: { pageIndex: opts.currentPage, x: coords.x, y: coords.y, preset: opts.stampPreset },
        afterEdit: async () => { await opts.refreshAnnotations(); },
        toast: 'Stamp added',
      });
      return;
    }
    if (opts.shapeMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (!opts.drawing) {
        opts.setHighlightStart(coords);
        opts.setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
        opts.setShapeLineEnd(coords);
        opts.setDrawing(true);
        return;
      }
      const start = opts.highlightStart;
      opts.cancelDrawing();
      if (!start) return;
      if (opts.shapeKind === 'line') {
        const dist = Math.hypot(coords.x - start.x, coords.y - start.y);
        if (dist < 5) return;
        void opts.runEdit({
          command: 'add_line',
          args: { pageIndex: opts.currentPage, x1: start.x, y1: start.y, x2: coords.x, y2: coords.y },
          afterEdit: async () => { await opts.refreshAnnotations(); },
          toast: 'Line added',
        });
        return;
      }
      const rect = {
        x: Math.min(start.x, coords.x),
        y: Math.min(start.y, coords.y),
        w: Math.abs(coords.x - start.x),
        h: Math.abs(coords.y - start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      void opts.runEdit({
        command: opts.shapeKind === 'circle' ? 'add_circle' : 'add_square',
        args: { pageIndex: opts.currentPage, x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h },
        afterEdit: async () => { await opts.refreshAnnotations(); },
        toast: opts.shapeKind === 'circle' ? 'Ellipse added' : 'Rectangle added',
      });
      return;
    }
    if (opts.noteMode) {
      const coords = getImageCoords(e.clientX, e.clientY);
      opts.setPendingNotePos(coords);
      opts.setNoteDraft('');
      opts.setShowNoteModal(true);
      return;
    }
    if (!opts.highlightMode) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    if (!opts.drawing) {
      opts.setHighlightStart(coords);
      opts.setHighlightRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
      opts.setDrawing(true);
      return;
    }
    const start = opts.highlightStart;
    opts.cancelDrawing();
    if (!start) return;
    const rect = {
      x: Math.min(start.x, coords.x),
      y: Math.min(start.y, coords.y),
      w: Math.abs(coords.x - start.x),
      h: Math.abs(coords.y - start.y),
    };
    if (rect.w < 5 || rect.h < 5) return;
    void opts.runEdit({
      command: 'add_highlight',
      args: { pageIndex: opts.currentPage, x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h },
      afterEdit: async () => { await opts.refreshAnnotations(); },
      toast: 'Highlight added',
    });
  }, [opts, getImageCoords]);

  const handlePageMouseMove = useCallback((e: React.MouseEvent) => {
    if (opts.drawMode && opts.inkDrawing) {
      const coords = getImageCoords(e.clientX, e.clientY);
      opts.setInkDraft((prev) => {
        if (prev.length < 2) return [...prev, coords.x, coords.y];
        const lx = prev[prev.length - 2];
        const ly = prev[prev.length - 1];
        if (Math.hypot(coords.x - lx, coords.y - ly) < 2) return prev;
        return [...prev, coords.x, coords.y];
      });
      return;
    }
    if ((opts.shapeMode || opts.redactMode || opts.imageInsertMode || opts.vectorEditMode || opts.formAddMode) && opts.drawing && opts.highlightStart) {
      const coords = getImageCoords(e.clientX, e.clientY);
      if (opts.shapeMode && opts.shapeKind === 'line') {
        opts.setShapeLineEnd(coords);
        return;
      }
      opts.setHighlightRect({
        x: Math.min(opts.highlightStart.x, coords.x),
        y: Math.min(opts.highlightStart.y, coords.y),
        w: Math.abs(coords.x - opts.highlightStart.x),
        h: Math.abs(coords.y - opts.highlightStart.y),
      });
      return;
    }
    if (!opts.highlightMode || !opts.drawing || !opts.highlightStart) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    opts.setHighlightRect({
      x: Math.min(opts.highlightStart.x, coords.x),
      y: Math.min(opts.highlightStart.y, coords.y),
      w: Math.abs(coords.x - opts.highlightStart.x),
      h: Math.abs(coords.y - opts.highlightStart.y),
    });
  }, [opts, getImageCoords]);

  return {
    handlePageClick,
    handlePageMouseMove,
    handleDrawMouseDown,
    handleDrawMouseUp,
  };
}
