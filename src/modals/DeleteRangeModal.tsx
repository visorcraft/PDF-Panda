import { Modal } from '../ui/Modal';
import { PageRangePairInputs } from '../pageRange/PageRangeFields';

type DeleteRangeModalProps = {
  startPage: number;
  endPage: number;
  pageCount: number | null;
  onStartChange: (page: number) => void;
  onEndChange: (page: number) => void;
  onClose: () => void;
  onDelete: () => void;
};

export function DeleteRangeModal({
  startPage,
  endPage,
  pageCount,
  onStartChange,
  onEndChange,
  onClose,
  onDelete,
}: DeleteRangeModalProps) {
  return (
    <Modal onClose={onClose}>
      <h3>Delete Page Range</h3>
      <p className="modal-help">Remove multiple pages from the working copy. At least one page must remain.</p>
      <PageRangePairInputs
        startPage={startPage}
        endPage={endPage}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
        maxPage={pageCount ?? undefined}
      />
      <div className="modal-actions">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button onClick={() => void onDelete()} className="btn btn-danger">Delete range</button>
      </div>
    </Modal>
  );
}
