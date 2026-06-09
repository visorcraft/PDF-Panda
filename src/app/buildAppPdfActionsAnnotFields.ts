import type { Dispatch, SetStateAction } from 'react';
import type { useAnnotationDraftState } from './useAnnotationDraftState';
import type { useAppRefs } from './useAppRefs';

type AnnotationState = ReturnType<typeof useAnnotationDraftState>;
type RefsState = ReturnType<typeof useAppRefs>;

export type DrawingGestureSlice = {
  cancelDrawing: () => void;
  drawing: boolean;
  highlightStart: { x: number; y: number } | null;
  highlightRect: { x: number; y: number; w: number; h: number } | null;
  inkDraft: number[];
  inkDrawing: boolean;
  shapeLineEnd: { x: number; y: number } | null;
  setDrawing: Dispatch<SetStateAction<boolean>>;
  setHighlightRect: Dispatch<SetStateAction<{ x: number; y: number; w: number; h: number } | null>>;
  setHighlightStart: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setInkDraft: Dispatch<SetStateAction<number[]>>;
  setInkDrawing: Dispatch<SetStateAction<boolean>>;
  setShapeLineEnd: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
};

export function annotationPdfActionFields(a: AnnotationState) {
  return {
    drawMode: a.drawMode,
    editingTextIndex: a.editingTextIndex,
    formAddMode: a.formAddMode,
    highlightMode: a.highlightMode,
    imageInsertMode: a.imageInsertMode,
    imageSourceDraft: a.imageSourceDraft,
    imageSourcePath: a.imageSourcePath,
    newFormCheckboxChecked: a.newFormCheckboxChecked,
    newFormFieldKind: a.newFormFieldKind,
    newFormFieldName: a.newFormFieldName,
    newFormFieldOptions: a.newFormFieldOptions,
    newFormRadioGroup: a.newFormRadioGroup,
    newFormRadioOption: a.newFormRadioOption,
    noteDraft: a.noteDraft,
    noteMode: a.noteMode,
    pageTextDraft: a.pageTextDraft,
    pageTextFontSize: a.pageTextFontSize,
    pendingNotePos: a.pendingNotePos,
    pendingTextPos: a.pendingTextPos,
    redactMode: a.redactMode,
    setDrawMode: a.setDrawMode,
    setEditingTextIndex: a.setEditingTextIndex,
    setFormAddMode: a.setFormAddMode,
    setHighlightMode: a.setHighlightMode,
    setImageInsertMode: a.setImageInsertMode,
    setImageSourceDraft: a.setImageSourceDraft,
    setImageSourcePath: a.setImageSourcePath,
    setNewFormCheckboxChecked: a.setNewFormCheckboxChecked,
    setNewFormFieldKind: a.setNewFormFieldKind,
    setNewFormFieldName: a.setNewFormFieldName,
    setNewFormFieldOptions: a.setNewFormFieldOptions,
    setNewFormRadioGroup: a.setNewFormRadioGroup,
    setNewFormRadioOption: a.setNewFormRadioOption,
    setNoteDraft: a.setNoteDraft,
    setNoteMode: a.setNoteMode,
    setPageTextDraft: a.setPageTextDraft,
    setPageTextFontSize: a.setPageTextFontSize,
    setPendingNotePos: a.setPendingNotePos,
    setPendingTextPos: a.setPendingTextPos,
    setRedactMode: a.setRedactMode,
    setShapeMode: a.setShapeMode,
    setShowAddFormFieldModal: a.setShowAddFormFieldModal,
    setShowImageInsertModal: a.setShowImageInsertModal,
    setShowNoteModal: a.setShowNoteModal,
    setShowPageEditsModal: a.setShowPageEditsModal,
    setShowPageTextModal: a.setShowPageTextModal,
    setStampMode: a.setStampMode,
    setTextEditMode: a.setTextEditMode,
    setVectorEditMode: a.setVectorEditMode,
    shapeKind: a.shapeKind,
    shapeMode: a.shapeMode,
    stampKind: a.stampKind,
    stampMode: a.stampMode,
    stampPreset: a.stampPreset,
    textEditMode: a.textEditMode,
    vectorEditMode: a.vectorEditMode,
  };
}

export function drawingPdfActionFields(g: DrawingGestureSlice) {
  return {
    cancelDrawing: g.cancelDrawing,
    drawing: g.drawing,
    highlightStart: g.highlightStart,
    inkDraft: g.inkDraft,
    inkDrawing: g.inkDrawing,
    setDrawing: g.setDrawing,
    setHighlightRect: g.setHighlightRect,
    setHighlightStart: g.setHighlightStart,
    setInkDraft: g.setInkDraft,
    setInkDrawing: g.setInkDrawing,
    setShapeLineEnd: g.setShapeLineEnd,
  };
}

export function refsPdfActionFields(refs: Pick<RefsState, 'cancelDrawingRef' | 'handleSaveRef' | 'handleMarkdownViewRef' | 'imgRef'>) {
  return {
    cancelDrawingRef: refs.cancelDrawingRef,
    handleMarkdownViewRef: refs.handleMarkdownViewRef,
    handleSaveRef: refs.handleSaveRef,
    imgRef: refs.imgRef,
  };
}
