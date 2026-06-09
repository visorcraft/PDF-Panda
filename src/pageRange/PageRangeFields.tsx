import type { PageRangeController } from './usePageRange';

type PageRangeFieldsProps = {
  range: PageRangeController;
  pageCount: number | null;
  applyLabel?: string;
};

export function PageRangeFields({ range, pageCount, applyLabel = 'Apply to:' }: PageRangeFieldsProps) {
  return (
    <>
      <label>{applyLabel}</label>
      <select
        className="modal-input"
        value={range.scope}
        onChange={(e) => range.setScope(e.target.value as typeof range.scope)}
      >
        <option value="current">Current page only</option>
        <option value="range">Page range</option>
        <option value="all">All pages</option>
      </select>
      {range.scope === 'range' && (
        <PageRangePairInputs
          startPage={range.startPage}
          endPage={range.endPage}
          onStartChange={range.setStartPage}
          onEndChange={range.setEndPage}
          maxPage={pageCount ?? undefined}
        />
      )}
    </>
  );
}

type PageRangePairInputsProps = {
  startPage: number;
  endPage: number;
  onStartChange: (page: number) => void;
  onEndChange: (page: number) => void;
  maxPage?: number;
  minPage?: number;
  fromLabel?: string;
  toLabel?: string;
};

export function PageRangePairInputs({
  startPage,
  endPage,
  onStartChange,
  onEndChange,
  maxPage,
  minPage = 1,
  fromLabel,
  toLabel,
}: PageRangePairInputsProps) {
  const resolvedFromLabel = fromLabel ?? (maxPage !== undefined ? `From page (1-${maxPage}):` : 'From page:');
  const resolvedToLabel = toLabel ?? (maxPage !== undefined ? `To page (1-${maxPage}):` : 'To page:');
  const parsePage = (value: string) => Math.max(0, (parseInt(value, 10) || 1) - 1);

  return (
    <>
      <label>
        {resolvedFromLabel}
        {' '}
        <input
          type="number"
          value={startPage + 1}
          onChange={(e) => onStartChange(parsePage(e.target.value))}
          min={minPage}
          max={maxPage}
          className="modal-input"
        />
      </label>
      <label>
        {resolvedToLabel}
        {' '}
        <input
          type="number"
          value={endPage + 1}
          onChange={(e) => onEndChange(parsePage(e.target.value))}
          min={minPage}
          max={maxPage}
          className="modal-input"
        />
      </label>
    </>
  );
}
