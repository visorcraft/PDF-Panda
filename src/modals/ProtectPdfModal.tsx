import { Modal } from '../ui/Modal';

type ProtectPdfModalProps = {
  userPassword: string;
  userPasswordConfirm: string;
  ownerPassword: string;
  onUserPasswordChange: (value: string) => void;
  onUserPasswordConfirmChange: (value: string) => void;
  onOwnerPasswordChange: (value: string) => void;
  onClose: () => void;
  onProtect: () => void;
};

export function ProtectPdfModal({
  userPassword,
  userPasswordConfirm,
  ownerPassword,
  onUserPasswordChange,
  onUserPasswordConfirmChange,
  onOwnerPasswordChange,
  onClose,
  onProtect,
}: ProtectPdfModalProps) {
  return (
    <Modal onClose={onClose}>
      <h3>Password protect</h3>
      <p className="modal-help">Writes an encrypted copy as <code>&lt;name&gt;_protected.pdf</code> beside the working file. The open document stays editable.</p>
      <label>User password:</label>
      <input
        type="password"
        value={userPassword}
        onChange={(e) => onUserPasswordChange(e.target.value)}
        className="modal-input"
      />
      <label>Confirm user password:</label>
      <input
        type="password"
        value={userPasswordConfirm}
        onChange={(e) => onUserPasswordConfirmChange(e.target.value)}
        className="modal-input"
      />
      <label>Owner password (optional):</label>
      <input
        type="password"
        value={ownerPassword}
        onChange={(e) => onOwnerPasswordChange(e.target.value)}
        className="modal-input"
        placeholder="Defaults to user password"
      />
      <div className="modal-actions">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button
          onClick={() => void onProtect()}
          className="btn"
          disabled={!userPassword || !userPasswordConfirm}
        >
          Protect
        </button>
      </div>
    </Modal>
  );
}
