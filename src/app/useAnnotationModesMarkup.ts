import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { clearOtherModes, type ModeSetters } from './annotationModeHelpers';

export type UseAnnotationModesMarkupOptions = ModeSetters & {
  setShowFormsPanel: Dispatch<SetStateAction<boolean>>;
};

export function useAnnotationModesMarkup(opts: UseAnnotationModesMarkupOptions) {
  const {
    cancelDrawing,
    setHighlightMode,
    setNoteMode,
    setDrawMode,
    setShapeMode,
    setStampMode,
    setRedactMode,
    setTextEditMode,
    setVectorEditMode,
    setShowNoteModal,
    setPendingNotePos,
    setNoteDraft,
  } = opts;

  const modes: ModeSetters = opts;

  const toggleHighlightMode = useCallback(() => {
    clearOtherModes(modes, 'highlight');
    setHighlightMode((m) => !m);
  }, [setHighlightMode, modes]);

  const exitHighlightMode = useCallback(() => {
    cancelDrawing();
    setHighlightMode(false);
  }, [cancelDrawing, setHighlightMode]);

  const toggleNoteMode = useCallback(() => {
    clearOtherModes(modes, 'note');
    setNoteMode((m) => !m);
  }, [setNoteMode, modes]);

  const toggleDrawMode = useCallback(() => {
    clearOtherModes(modes, 'draw');
    setDrawMode((m) => !m);
  }, [setDrawMode, modes]);

  const exitDrawMode = useCallback(() => {
    cancelDrawing();
    setDrawMode(false);
  }, [cancelDrawing, setDrawMode]);

  const toggleShapeMode = useCallback(() => {
    clearOtherModes(modes, 'shape');
    setShapeMode((m) => !m);
  }, [setShapeMode, modes]);

  const exitShapeMode = useCallback(() => {
    cancelDrawing();
    setShapeMode(false);
  }, [cancelDrawing, setShapeMode]);

  const toggleStampMode = useCallback(() => {
    clearOtherModes(modes, 'stamp');
    setStampMode((m) => !m);
  }, [setStampMode, modes]);

  const exitStampMode = useCallback(() => {
    setStampMode(false);
  }, [setStampMode]);

  const toggleTextEditMode = useCallback(() => {
    clearOtherModes(modes, 'text');
    setTextEditMode((mode) => !mode);
  }, [setTextEditMode, modes]);

  const toggleVectorEditMode = useCallback(() => {
    clearOtherModes(modes, 'vector');
    setVectorEditMode((mode) => !mode);
  }, [setVectorEditMode, modes]);

  const toggleRedactMode = useCallback(() => {
    clearOtherModes(modes, 'redact');
    setRedactMode((m) => !m);
  }, [setRedactMode, modes]);

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
