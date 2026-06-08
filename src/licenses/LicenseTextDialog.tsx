type LicenseTextDialogProps = {
  title: string;
  detail: string;
  body: string;
  onClose: () => void;
};

export function LicenseTextDialog({ title, detail, body, onClose }: LicenseTextDialogProps) {
  return (
    <div className="modal-backdrop licenses-gpl-backdrop" onClick={onClose}>
      <div className="modal licenses-gpl-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="modal-help">{detail}</p>
        <textarea className="licenses-gpl-dialog-body" readOnly value={body} />
        <div className="modal-actions">
          <button type="button" className="btn btn-active" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
