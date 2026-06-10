import { useEffect, type ComponentProps } from 'react';
import type { PdfPageSize } from '../app/types';
import { PdfPageView } from './PdfPageView';

type PdfPageProps = ComponentProps<typeof PdfPageView>;

type ContinuousViewerProps = {
  pageCount: number;
  currentPage: number;
  placeholderHeight: (page: number) => number;
  registerPageRef: (page: number, el: HTMLDivElement | null) => void;
  getPageUrl: (page: number) => string | null;
  requestPage: (page: number) => void;
  renderPages: Set<number>;
  pdfPage: Omit<PdfPageProps, 'imageSrc' | 'currentPage'>;
  pageImageSrc: string | null;
  pageSizes: PdfPageSize[];
};

export function ContinuousViewer({
  pageCount,
  currentPage,
  placeholderHeight,
  registerPageRef,
  getPageUrl,
  requestPage,
  renderPages,
  pdfPage,
  pageImageSrc,
}: ContinuousViewerProps) {
  useEffect(() => {
    for (const page of renderPages) {
      requestPage(page);
    }
  }, [renderPages, requestPage]);

  return (
    <div className="continuous-viewer">
      {Array.from({ length: pageCount }, (_, page) => {
        const height = placeholderHeight(page);
        const showPage = renderPages.has(page);
        const imageSrc = page === currentPage ? pageImageSrc : getPageUrl(page);
        const isActive = page === currentPage;

        return (
          <div
            key={page}
            className="continuous-page-slot"
            data-page-index={page}
            data-testid={showPage ? `continuous-page-${page + 1}` : undefined}
            ref={(el) => registerPageRef(page, el)}
            style={{ minHeight: height }}
          >
            {showPage && imageSrc ? (
              <PdfPageView
                {...pdfPage}
                currentPage={page}
                imageSrc={imageSrc}
                highlightMode={isActive ? pdfPage.highlightMode : false}
                noteMode={isActive ? pdfPage.noteMode : false}
                drawMode={isActive ? pdfPage.drawMode : false}
                shapeMode={isActive ? pdfPage.shapeMode : false}
                stampMode={isActive ? pdfPage.stampMode : false}
                redactMode={isActive ? pdfPage.redactMode : false}
                imageInsertMode={isActive ? pdfPage.imageInsertMode : false}
                textEditMode={isActive ? pdfPage.textEditMode : false}
                vectorEditMode={isActive ? pdfPage.vectorEditMode : false}
                formAddMode={isActive ? pdfPage.formAddMode : false}
                annotations={isActive ? pdfPage.annotations : []}
                activeSearchRect={isActive ? pdfPage.activeSearchRect : null}
                textRuns={isActive ? pdfPage.textRuns : []}
                textLayerInteractive={isActive ? pdfPage.textLayerInteractive : false}
                pageTextEdits={isActive ? pdfPage.pageTextEdits : []}
                pageVectorEdits={isActive ? pdfPage.pageVectorEdits : []}
                drawing={isActive ? pdfPage.drawing : false}
                highlightStart={isActive ? pdfPage.highlightStart : null}
                highlightRect={isActive ? pdfPage.highlightRect : null}
                shapeLineEnd={isActive ? pdfPage.shapeLineEnd : null}
                inkDraft={isActive ? pdfPage.inkDraft : []}
              />
            ) : showPage ? (
              <p className="muted page-loading">Loading page {page + 1}…</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
