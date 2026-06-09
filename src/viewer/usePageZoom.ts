import { ZOOM_STEP } from '../app/constants';
import { clampZoom } from '../app/utils';

type UsePageZoomOptions = {
  zoom: number;
  setZoom: (value: number | ((prev: number) => number)) => void;
  zoomInput: string;
  setZoomInput: (value: string) => void;
  pageInput: string;
  setPageInput: (value: string) => void;
  pageCount: number | null;
  currentPage: number;
  goToPage: (index: number) => void;
};

export function usePageZoom({
  zoom,
  setZoom,
  zoomInput,
  setZoomInput,
  pageInput,
  setPageInput,
  pageCount,
  currentPage,
  goToPage,
}: UsePageZoomOptions) {
  const zoomIn = () => setZoom((z) => clampZoom(+(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => clampZoom(+(z - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => setZoom(1);

  const commitZoom = () => {
    const n = parseInt(zoomInput, 10);
    if (Number.isNaN(n)) {
      setZoomInput(String(Math.round(zoom * 100)));
      return;
    }
    setZoom(clampZoom(n / 100));
  };

  const commitPage = () => {
    const n = parseInt(pageInput, 10);
    if (Number.isNaN(n) || pageCount === null) {
      setPageInput(String(currentPage + 1));
      return;
    }
    goToPage(n - 1);
  };

  return { zoomIn, zoomOut, resetZoom, commitZoom, commitPage };
}
