import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import type { FormFieldKind } from '../modals/AddFormFieldModal';

type ModeSetters = {
  cancelDrawing: () => void;
  setHighlightMode: React.Dispatch<React.SetStateAction<boolean>>;
  setNoteMode: React.Dispatch<React.SetStateAction<boolean>>;
  setDrawMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShapeMode: React.Dispatch<React.SetStateAction<boolean>>;
  setStampMode: React.Dispatch<React.SetStateAction<boolean>>;
  setRedactMode: React.Dispatch<React.SetStateAction<boolean>>;
  setImageInsertMode: React.Dispatch<React.SetStateAction<boolean>>;
  setFormAddMode: React.Dispatch<React.SetStateAction<boolean>>;
  setTextEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  setVectorEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowNoteModal: (open: boolean) => void;
  setPendingNotePos: (pos: null) => void;
  setNoteDraft: (draft: string) => void;
};

function clearOtherModes(
  modes: ModeSetters,
  except?: 'highlight' | 'note' | 'draw' | 'shape' | 'stamp' | 'redact' | 'image' | 'form' | 'text' | 'vector',
) {
  modes.cancelDrawing();
  if (except !== 'highlight') modes.setHighlightMode(false);
  if (except !== 'note') modes.setNoteMode(false);
  if (except !== 'draw') modes.setDrawMode(false);
  if (except !== 'shape') modes.setShapeMode(false);
  if (except !== 'stamp') modes.setStampMode(false);
  if (except !== 'redact') modes.setRedactMode(false);
  if (except !== 'image') modes.setImageInsertMode(false);
  if (except !== 'form') modes.setFormAddMode(false);
  if (except !== 'text') modes.setTextEditMode(false);
  if (except !== 'vector') modes.setVectorEditMode(false);
  modes.setShowNoteModal(false);
  modes.setPendingNotePos(null);
}

type UseAnnotationModesOptions = ModeSetters & {
  filePath: string;
  imageSourcePath: string;
  imageSourceDraft: string;
  newFormFieldKind: FormFieldKind;
  newFormFieldName: string;
  newFormFieldOptions: string;
  newFormRadioGroup: string;
  newFormRadioOption: string;
  newFormCheckboxChecked: boolean;
  showToast: (msg: string, kind?: 'error') => void;
  setImageSourceDraft: (path: string) => void;
  setImageSourcePath: (path: string) => void;
  setShowImageInsertModal: (open: boolean) => void;
  setShowAddFormFieldModal: (open: boolean) => void;
  setNewFormFieldKind: (kind: FormFieldKind) => void;
  setNewFormFieldName: (name: string) => void;
  setNewFormFieldOptions: (options: string) => void;
  setNewFormRadioGroup: (group: string) => void;
  setNewFormRadioOption: (option: string) => void;
  setNewFormCheckboxChecked: (checked: boolean) => void;
  setShowFormsPanel: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useAnnotationModes(opts: UseAnnotationModesOptions) {
  const {
    cancelDrawing,
    setHighlightMode,
    setNoteMode,
    setDrawMode,
    setShapeMode,
    setStampMode,
    setRedactMode,
    setImageInsertMode,
    setFormAddMode,
    setTextEditMode,
    setVectorEditMode,
    setShowNoteModal,
    setPendingNotePos,
    setNoteDraft,
    filePath,
    imageSourcePath,
    imageSourceDraft,
    newFormFieldKind,
    newFormFieldName,
    newFormFieldOptions,
    newFormRadioGroup,
    newFormRadioOption,
    showToast,
    setImageSourceDraft,
    setImageSourcePath,
    setShowImageInsertModal,
    setShowAddFormFieldModal,
    setNewFormFieldKind,
    setNewFormFieldName,
    setNewFormFieldOptions,
    setNewFormRadioGroup,
    setNewFormRadioOption,
    setNewFormCheckboxChecked,
  } = opts;

  const modes: ModeSetters = {
    cancelDrawing,
    setHighlightMode,
    setNoteMode,
    setDrawMode,
    setShapeMode,
    setStampMode,
    setRedactMode,
    setImageInsertMode,
    setFormAddMode,
    setTextEditMode,
    setVectorEditMode,
    setShowNoteModal,
    setPendingNotePos,
    setNoteDraft,
  };

  const openImageInsertModal = useCallback(() => {
    if (!filePath) return;
    setImageSourceDraft(imageSourcePath);
    setShowImageInsertModal(true);
  }, [filePath, imageSourcePath, setImageSourceDraft, setShowImageInsertModal]);

  const confirmImageSource = useCallback(async () => {
    const path = imageSourceDraft.trim();
    if (!path) {
      showToast('Enter an image path', 'error');
      return;
    }
    try {
      await invoke<[number, number]>('get_image_dimensions', { path });
      setImageSourcePath(path);
      setShowImageInsertModal(false);
      clearOtherModes(modes);
      setImageInsertMode(true);
      showToast('Click twice on the page to place the image');
    } catch (err) {
      showToast(String(err), 'error');
    }
  }, [imageSourceDraft, showToast, setImageSourcePath, setShowImageInsertModal, setImageInsertMode]);

  const toggleImageInsertMode = useCallback(() => {
    if (!imageSourcePath) {
      openImageInsertModal();
      return;
    }
    clearOtherModes(modes);
    setImageInsertMode((m) => !m);
  }, [imageSourcePath, openImageInsertModal, setImageInsertMode]);

  const exitImageInsertMode = useCallback(() => {
    cancelDrawing();
    setImageInsertMode(false);
    setFormAddMode(false);
  }, [cancelDrawing, setImageInsertMode, setFormAddMode]);

  const openAddFormFieldModal = useCallback(() => {
    if (!filePath) return;
    setNewFormFieldKind('text');
    setNewFormFieldName('');
    setNewFormFieldOptions('Option A, Option B');
    setNewFormRadioGroup('');
    setNewFormRadioOption('');
    setNewFormCheckboxChecked(false);
    setShowAddFormFieldModal(true);
  }, [
    filePath,
    setNewFormFieldKind,
    setNewFormFieldName,
    setNewFormFieldOptions,
    setNewFormRadioGroup,
    setNewFormRadioOption,
    setNewFormCheckboxChecked,
    setShowAddFormFieldModal,
  ]);

  const confirmAddFormField = useCallback(() => {
    if (newFormFieldKind === 'radio') {
      if (!newFormRadioGroup.trim() || !newFormRadioOption.trim()) {
        showToast('Enter group and option names', 'error');
        return;
      }
    } else if (!newFormFieldName.trim()) {
      showToast('Enter a field name', 'error');
      return;
    }
    if (newFormFieldKind === 'choice') {
      const options = newFormFieldOptions.split(',').map((o) => o.trim()).filter(Boolean);
      if (options.length === 0) {
        showToast('Enter at least one option', 'error');
        return;
      }
    }
    setShowAddFormFieldModal(false);
    clearOtherModes(modes);
    setFormAddMode(true);
    const placementHint = newFormFieldKind === 'text' || newFormFieldKind === 'choice'
      ? 'Click twice on the page to draw the field box'
      : 'Click on the page to place the field';
    showToast(placementHint);
  }, [
    newFormFieldKind,
    newFormFieldName,
    newFormFieldOptions,
    newFormRadioGroup,
    newFormRadioOption,
    showToast,
    setShowAddFormFieldModal,
    setFormAddMode,
  ]);

  const exitFormAddMode = useCallback(() => {
    cancelDrawing();
    setFormAddMode(false);
  }, [cancelDrawing, setFormAddMode]);

  const toggleHighlightMode = useCallback(() => {
    clearOtherModes(modes, 'highlight');
    setHighlightMode((m) => !m);
  }, [setHighlightMode]);

  const exitHighlightMode = useCallback(() => {
    cancelDrawing();
    setHighlightMode(false);
  }, [cancelDrawing, setHighlightMode]);

  const toggleNoteMode = useCallback(() => {
    clearOtherModes(modes, 'note');
    setNoteMode((m) => !m);
  }, [setNoteMode]);

  const toggleDrawMode = useCallback(() => {
    clearOtherModes(modes, 'draw');
    setDrawMode((m) => !m);
  }, [setDrawMode]);

  const exitDrawMode = useCallback(() => {
    cancelDrawing();
    setDrawMode(false);
  }, [cancelDrawing, setDrawMode]);

  const toggleShapeMode = useCallback(() => {
    clearOtherModes(modes, 'shape');
    setShapeMode((m) => !m);
  }, [setShapeMode]);

  const exitShapeMode = useCallback(() => {
    cancelDrawing();
    setShapeMode(false);
  }, [cancelDrawing, setShapeMode]);

  const toggleStampMode = useCallback(() => {
    clearOtherModes(modes, 'stamp');
    setStampMode((m) => !m);
  }, [setStampMode]);

  const exitStampMode = useCallback(() => {
    setStampMode(false);
  }, [setStampMode]);

  const toggleTextEditMode = useCallback(() => {
    clearOtherModes(modes, 'text');
    setTextEditMode((mode) => !mode);
  }, [setTextEditMode]);

  const toggleVectorEditMode = useCallback(() => {
    clearOtherModes(modes, 'vector');
    setVectorEditMode((mode) => !mode);
  }, [setVectorEditMode]);

  const toggleRedactMode = useCallback(() => {
    clearOtherModes(modes, 'redact');
    setRedactMode((m) => !m);
  }, [setRedactMode]);

  const exitRedactMode = useCallback(() => {
    cancelDrawing();
    setRedactMode(false);
  }, [cancelDrawing, setRedactMode]);

  const exitNoteMode = useCallback(() => {
    setNoteMode(false);
    setShowNoteModal(false);
    setPendingNotePos(null);
    setNoteDraft('');
  }, [setNoteMode, setShowNoteModal, setPendingNotePos, setNoteDraft]);

  const toggleFormsPanel = useCallback(() => {
    opts.setShowFormsPanel((open) => !open);
  }, [opts.setShowFormsPanel]);

  return {
    openImageInsertModal,
    confirmImageSource,
    toggleImageInsertMode,
    exitImageInsertMode,
    openAddFormFieldModal,
    confirmAddFormField,
    exitFormAddMode,
    toggleHighlightMode,
    exitHighlightMode,
    toggleNoteMode,
    toggleDrawMode,
    exitDrawMode,
    toggleShapeMode,
    exitShapeMode,
    toggleStampMode,
    exitStampMode,
    toggleTextEditMode,
    toggleVectorEditMode,
    toggleRedactMode,
    exitRedactMode,
    exitNoteMode,
    toggleFormsPanel,
  };
}
