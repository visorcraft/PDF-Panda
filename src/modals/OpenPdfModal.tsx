import { useId, type KeyboardEvent } from 'react';
import { Modal } from '../ui/Modal';

type OpenPdfModalProps = {
  filePath: string;
  nativeDialogs: boolean;
  recentPdfs: string[];
  fileNameFromPath: (path: string) => string;
  onFilePathChange: (path: string) => void;
  onClose: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onChooseNative: () => void;
  onBrowse: () => void;
};

export function OpenPdfModal({
  filePath,
  nativeDialogs,
  recentPdfs,
  fileNameFromPath,
  onFilePathChange,
  onClose,
  onOpen,
  onOpenRecent,
  onChooseNative,
  onBrowse,
}: OpenPdfModalProps) {
  const pathId = useId();

  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onOpen();
      e.currentTarget.blur();
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>Open PDF</h3>
      {!nativeDialogs && (
        <p className="modal-help">Native file picker is disabled for this session. Enter a path or use Browse….</p>
      )}
      <label htmlFor={pathId}>PDF path:</label>
      <div className="modal-path-row">
        <input
          id={pathId}
          type="text"
          value={filePath}
          onChange={(e) => onFilePathChange(e.target.value)}
          onKeyDown={onFieldKeyDown}
          className="modal-input"
          placeholder="/path/to/document.pdf"
          data-testid="open-pdf-path"
          autoFocus
        />
        {nativeDialogs && (
          <button onClick={() => void onChooseNative()} className="btn" data-testid="native-open-pdf">Choose file…</button>
        )}
        <button onClick={onBrowse} className="btn">Browse…</button>
      </div>
      {recentPdfs.length > 0 && (
        <div className="recent-list" aria-label="Recently opened PDFs">
          <h4>Recently Opened</h4>
          {recentPdfs.map((path) => (
            <button key={path} className="recent-row" onClick={() => onOpenRecent(path)}>
              <span className="recent-name">{fileNameFromPath(path)}</span>
              <span className="recent-path">{path}</span>
            </button>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        <button onClick={onOpen} className="btn" disabled={!filePath.trim()} data-testid="open-pdf-submit">Open</button>
      </div>
    </Modal>
  );
}
