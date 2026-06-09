import type { ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { PageRangeFields } from '../pageRange/PageRangeFields';
import type { PageRangeController } from '../pageRange/usePageRange';

type ScopedPageActionModalProps = {
  title: string;
  help: string;
  range: PageRangeController;
  pageCount: number | null;
  onClose: () => void;
  onApply: () => void;
  onApplyOdd?: () => void;
  onApplyEven?: () => void;
  applyLabel?: string;
  applyDisabled?: boolean;
  rangeFirst?: boolean;
  children?: ReactNode;
};

export function ScopedPageActionModal({
  title,
  help,
  range,
  pageCount,
  onClose,
  onApply,
  onApplyOdd,
  onApplyEven,
  applyLabel = 'Apply',
  applyDisabled = false,
  rangeFirst = false,
  children,
}: ScopedPageActionModalProps) {
  const hasParity = onApplyOdd !== undefined && onApplyEven !== undefined;
  const rangeFields = <PageRangeFields range={range} pageCount={pageCount} />;

  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      <p className="modal-help">{help}</p>
      {rangeFirst ? rangeFields : children}
      {!rangeFirst && rangeFields}
      {rangeFirst && children}
      <div className="modal-actions">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        {hasParity && (
          <>
            <button onClick={() => void onApplyOdd()} className="btn" disabled={applyDisabled}>Apply Odd</button>
            <button onClick={() => void onApplyEven()} className="btn" disabled={applyDisabled}>Apply Even</button>
          </>
        )}
        <button onClick={() => void onApply()} className="btn" disabled={applyDisabled}>{applyLabel}</button>
      </div>
    </Modal>
  );
}
