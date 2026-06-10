import { Modal } from '../ui/Modal';

type ApplyRedactionsModalProps = {
  ocrAvailable: boolean;
  ocrAfter: boolean;
  onOcrAfterChange: (value: boolean) => void;
  onClose: () => void;
  onApply: () => void;
  onOpenTesseractGuide: () => void;
};

export function ApplyRedactionsModal({
  ocrAvailable,
  ocrAfter,
  onOcrAfterChange,
  onClose,
  onApply,
  onOpenTesseractGuide,
}: ApplyRedactionsModalProps) {
  return (
    <Modal onClose={onClose}>
      <h3>Apply Redactions</h3>
      <p className="modal-help">
        Rasterizes pages with redaction boxes. Text, vectors, and form fields on those pages are
        permanently removed (undo available until you save).
      </p>
      <label className="modal-checkbox">
        <input
          type="checkbox"
          checked={ocrAfter}
          disabled={!ocrAvailable}
          onChange={(e) => onOcrAfterChange(e.target.checked)}
        />
        Restore searchable text (OCR)
      </label>
      {!ocrAvailable && (
        <p className="modal-help">
          Tesseract is not installed.{' '}
          <button type="button" className="link-btn" onClick={onOpenTesseractGuide}>
            Install guide…
          </button>
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button type="button" onClick={() => void onApply()} className="btn btn-danger">Apply Redactions</button>
      </div>
    </Modal>
  );
}
