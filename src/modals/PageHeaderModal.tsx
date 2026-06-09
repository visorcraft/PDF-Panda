import { ScopedPageActionModal } from './ScopedPageActionModal';
import type { PageRangeController } from '../pageRange/usePageRange';

type PageHeaderModalProps = {
  range: PageRangeController;
  pageCount: number | null;
  text: string;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onApply: () => void;
  onApplyOdd: () => void;
  onApplyEven: () => void;
};

export function PageHeaderModal({
  range,
  pageCount,
  text,
  onTextChange,
  onClose,
  onApply,
  onApplyOdd,
  onApplyEven,
}: PageHeaderModalProps) {
  const disabled = !text.trim();

  return (
    <ScopedPageActionModal
      title="Page Header"
      help="Stamp header text near the top of selected pages."
      range={range}
      pageCount={pageCount}
      onClose={onClose}
      onApply={onApply}
      onApplyOdd={onApplyOdd}
      onApplyEven={onApplyEven}
      applyDisabled={disabled}
    >
      <label>Header text:</label>
      <input
        type="text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        className="modal-input"
      />
    </ScopedPageActionModal>
  );
}
