import { Modal } from '../ui/Modal';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

type UnsavedChangesModalProps = {
  onClose: () => void;
  onChoose: (choice: UnsavedChoice) => void;
};

export function UnsavedChangesModal({ onClose, onChoose }: UnsavedChangesModalProps) {
  return (
    <Modal onClose={onClose}>
      <h3>Unsaved changes</h3>
      <p className="modal-help">You have unsaved edits to this document. Save them before continuing?</p>
      <div className="modal-actions">
        <button onClick={() => onChoose('cancel')} className="btn btn-secondary">Cancel</button>
        <button onClick={() => onChoose('discard')} className="btn">Discard</button>
        <button onClick={() => onChoose('save')} className="btn btn-active">Save</button>
      </div>
    </Modal>
  );
}
