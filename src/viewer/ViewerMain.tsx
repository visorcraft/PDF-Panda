import type React from 'react';
import pandaWelcome from '../assets/panda.png';
import type { MarkdownOcrNotice, ViewMode } from '../app/types';
import { PdfPageView } from './PdfPageView';

type ViewerMainProps = {
  filePath: string;
  viewMode: ViewMode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onWheel: (e: React.WheelEvent) => void;
  onOpenPdf: () => void;
  markdownOcrNotice: MarkdownOcrNotice | null;
  markdownPath: string;
  markdownText: string;
  onOpenMarkdownSaveAs: () => void;
  pdfPage: React.ComponentProps<typeof PdfPageView>;
};

export function ViewerMain({
  filePath,
  viewMode,
  scrollRef,
  onWheel,
  onOpenPdf,
  markdownOcrNotice,
  markdownPath,
  markdownText,
  onOpenMarkdownSaveAs,
  pdfPage,
}: ViewerMainProps) {
  return (
    <main className="main">
      <div
        className={`page-scroll${!filePath ? ' welcome-scroll' : ''}${viewMode === 'markdown' ? ' markdown-scroll' : ''}`}
        ref={scrollRef}
        onWheel={onWheel}
      >
        {!filePath ? (
          <button
            type="button"
            className="welcome-splash"
            onClick={onOpenPdf}
            data-testid="welcome-open-pdf"
            aria-label="Click to open a PDF"
          >
            <img src={pandaWelcome} alt="" className="welcome-panda" aria-hidden="true" />
            <span className="welcome-hint">Click to open a PDF</span>
          </button>
        ) : viewMode === 'markdown' ? (
          <div className="markdown-viewer">
            <div className="markdown-header">
              <span>Markdown</span>
              {markdownOcrNotice && (
                <span className={`markdown-ocr-badge ${markdownOcrNotice.tone === 'success' ? 'ready' : 'missing'}`}>
                  {markdownOcrNotice.message}
                </span>
              )}
              {markdownPath && <span className="markdown-path">{markdownPath}</span>}
              <button type="button" onClick={onOpenMarkdownSaveAs} className="btn btn-secondary">Save As…</button>
            </div>
            <pre className="markdown-preview">{markdownText}</pre>
          </div>
        ) : (
          <PdfPageView {...pdfPage} />
        )}
      </div>
    </main>
  );
}
