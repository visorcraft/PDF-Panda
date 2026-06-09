import { PageRangePairModal } from './PageRangePairModal';

type RotateRangeModalProps = {
  startPage: number;
  endPage: number;
  pageCount: number | null;
  onStartChange: (page: number) => void;
  onEndChange: (page: number) => void;
  onClose: () => void;
  onRotateCw: () => void;
  onRotateCcw: () => void;
  onRotate180: () => void;
  onResetRotation: () => void;
};

export function RotateRangeModal({
  startPage,
  endPage,
  pageCount,
  onStartChange,
  onEndChange,
  onClose,
  onRotateCw,
  onRotateCcw,
  onRotate180,
  onResetRotation,
}: RotateRangeModalProps) {
  return (
    <PageRangePairModal
      title="Rotate Page Range"
      help="Rotate every page in the range 90° clockwise or counter-clockwise."
      startPage={startPage}
      endPage={endPage}
      pageCount={pageCount}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
      onClose={onClose}
      actions={(
        <>
          <button onClick={() => void onRotateCw()} className="btn">Rotate CW</button>
          <button onClick={() => void onRotateCcw()} className="btn">Rotate CCW</button>
          <button onClick={() => void onRotate180()} className="btn">Rotate 180°</button>
          <button onClick={() => void onResetRotation()} className="btn">Reset Rot.</button>
        </>
      )}
    />
  );
}
