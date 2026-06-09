import { useState } from 'react';
import type { PdfPageSize } from './types';

export function useAppModalStatePageOps() {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePageInput, setDeletePageInput] = useState('1');
  const [showPageNumbersModal, setShowPageNumbersModal] = useState(false);
  const [pageNumbersPrefix, setPageNumbersPrefix] = useState('Page ');
  const [showWatermarkModal, setShowWatermarkModal] = useState(false);
  const [watermarkText, setWatermarkText] = useState('DRAFT');
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropMarginTop, setCropMarginTop] = useState(50);
  const [cropMarginRight, setCropMarginRight] = useState(50);
  const [cropMarginBottom, setCropMarginBottom] = useState(50);
  const [cropMarginLeft, setCropMarginLeft] = useState(50);
  const [showFlattenModal, setShowFlattenModal] = useState(false);
  const [showAddBookmarkModal, setShowAddBookmarkModal] = useState(false);
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [showRenameBookmarkModal, setShowRenameBookmarkModal] = useState(false);
  const [renameBookmarkIndex, setRenameBookmarkIndex] = useState(0);
  const [renameBookmarkTitle, setRenameBookmarkTitle] = useState('');
  const [cropApplyAll, setCropApplyAll] = useState(false);
  const [pageSizes, setPageSizes] = useState<PdfPageSize[]>([]);
  const [showPageHeaderModal, setShowPageHeaderModal] = useState(false);
  const [pageHeaderText, setPageHeaderText] = useState('DRAFT');
  const [showInsertImagePageModal, setShowInsertImagePageModal] = useState(false);
  const [insertImagePagePath, setInsertImagePagePath] = useState('');
  const [insertImageAtIndex, setInsertImageAtIndex] = useState(0);
  const [showExportPagePdfModal, setShowExportPagePdfModal] = useState(false);
  const [exportPagePdfPath, setExportPagePdfPath] = useState('');
  const [showExportPagesPdfModal, setShowExportPagesPdfModal] = useState(false);
  const [exportPagesPdfOutputDir, setExportPagesPdfOutputDir] = useState('');
  const [showPageFooterModal, setShowPageFooterModal] = useState(false);
  const [pageFooterText, setPageFooterText] = useState('Confidential');
  const [showSwapPagesModal, setShowSwapPagesModal] = useState(false);
  const [swapPageA, setSwapPageA] = useState(0);
  const [swapPageB, setSwapPageB] = useState(1);

  return {
    showDeleteModal, setShowDeleteModal,
    deletePageInput, setDeletePageInput,
    showPageNumbersModal, setShowPageNumbersModal,
    pageNumbersPrefix, setPageNumbersPrefix,
    showWatermarkModal, setShowWatermarkModal,
    watermarkText, setWatermarkText,
    showCropModal, setShowCropModal,
    cropMarginTop, setCropMarginTop,
    cropMarginRight, setCropMarginRight,
    cropMarginBottom, setCropMarginBottom,
    cropMarginLeft, setCropMarginLeft,
    showFlattenModal, setShowFlattenModal,
    showAddBookmarkModal, setShowAddBookmarkModal,
    bookmarkTitle, setBookmarkTitle,
    showRenameBookmarkModal, setShowRenameBookmarkModal,
    renameBookmarkIndex, setRenameBookmarkIndex,
    renameBookmarkTitle, setRenameBookmarkTitle,
    cropApplyAll, setCropApplyAll,
    pageSizes, setPageSizes,
    showPageHeaderModal, setShowPageHeaderModal,
    pageHeaderText, setPageHeaderText,
    showInsertImagePageModal, setShowInsertImagePageModal,
    insertImagePagePath, setInsertImagePagePath,
    insertImageAtIndex, setInsertImageAtIndex,
    showExportPagePdfModal, setShowExportPagePdfModal,
    exportPagePdfPath, setExportPagePdfPath,
    showExportPagesPdfModal, setShowExportPagesPdfModal,
    exportPagesPdfOutputDir, setExportPagesPdfOutputDir,
    showPageFooterModal, setShowPageFooterModal,
    pageFooterText, setPageFooterText,
    showSwapPagesModal, setShowSwapPagesModal,
    swapPageA, setSwapPageA,
    swapPageB, setSwapPageB,
  };
}
