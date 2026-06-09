import type { RefObject } from 'react';
import { Modal } from '../ui/Modal';

export type PdfTextSearchMatch = {
  page_index: number;
  match_index: number;
  rect: [number, number, number, number];
};

type SearchModalProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  results: PdfTextSearchMatch[];
  resultIndex: number;
  onQueryChange: (value: string) => void;
  onMatchCaseChange: (checked: boolean) => void;
  onWholeWordChange: (checked: boolean) => void;
  onClose: () => void;
  onFind: () => void;
  onStepMatch: (direction: -1 | 1) => void;
};

export function SearchModal({
  inputRef,
  query,
  matchCase,
  wholeWord,
  results,
  resultIndex,
  onQueryChange,
  onMatchCaseChange,
  onWholeWordChange,
  onClose,
  onFind,
  onStepMatch,
}: SearchModalProps) {
  return (
    <Modal onClose={onClose}>
      <h3>Find in PDF</h3>
      <label>Search for:</label>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="modal-input"
        placeholder="Text to find"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onStepMatch(-1);
            else if (results.length > 0) onStepMatch(1);
            else void onFind();
          }
        }}
      />
      <div className="search-options">
        <label className="form-checkbox-row">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => onMatchCaseChange(e.target.checked)}
          />
          <span>Match case</span>
        </label>
        <label className="form-checkbox-row">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => onWholeWordChange(e.target.checked)}
          />
          <span>Whole words</span>
        </label>
      </div>
      {results.length > 0 && (
        <p className="modal-help">
          Match {resultIndex + 1} of {results.length} (page {results[resultIndex].page_index + 1})
        </p>
      )}
      <div className="modal-actions">
        <button onClick={onClose} className="btn btn-secondary">Close</button>
        <button type="button" onClick={() => onStepMatch(-1)} className="btn" disabled={results.length === 0}>Previous</button>
        <button type="button" onClick={() => onStepMatch(1)} className="btn" disabled={results.length === 0}>Next</button>
        <button onClick={() => void onFind()} className="btn" disabled={!query.trim()}>Find</button>
      </div>
    </Modal>
  );
}
