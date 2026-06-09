import { Modal } from '../ui/Modal';

type SplitPdfModalProps = {
  splitRanges: string;
  pageCount: number | null;
  onSplitRangesChange: (value: string) => void;
  onClose: () => void;
  onSplit: () => void;
};

export function SplitPdfModal({
  splitRanges,
  pageCount,
  onSplitRangesChange,
  onClose,
  onSplit,
}: SplitPdfModalProps) {
  return (
    <Modal onClose={onClose}>
      <h3>Split PDF</h3>
      <p>Enter page ranges (e.g., &quot;1-3, 4-5, 6-10&quot;):</p>
      <input
        type="text"
        value={splitRanges}
        onChange={(e) => onSplitRangesChange(e.target.value)}
        className="modal-input"
        placeholder="1-3, 4-6"
      />
      <p className="muted">Total pages: {pageCount}</p>
      <div className="modal-actions">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button onClick={onSplit} className="btn">Split</button>
      </div>
    </Modal>
  );
}
