import { useState } from 'react';
import type { ImageExportFormat } from '../pdf/imageExportCommands';
import type { PageSizePreset } from '../modals/PageSizeModal';

export function useAppModalStateMergeInsert() {
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitRanges, setSplitRanges] = useState<string>('');
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractOutputPath, setExtractOutputPath] = useState('');
  const [showExportPngModal, setShowExportPngModal] = useState(false);
  const [pngExportOutputPath, setPngExportOutputPath] = useState('');
  const [imageExportFormat, setImageExportFormat] = useState<ImageExportFormat>('png');
  const [showReplacePageModal, setShowReplacePageModal] = useState(false);
  const [replaceSourcePath, setReplaceSourcePath] = useState('');
  const [replaceSourcePage, setReplaceSourcePage] = useState(0);
  const [replaceSourcePageCount, setReplaceSourcePageCount] = useState<number | null>(null);
  const [showInterleaveModal, setShowInterleaveModal] = useState(false);
  const [interleaveFilePath, setInterleaveFilePath] = useState('');
  const [interleaveSourcePageCount, setInterleaveSourcePageCount] = useState<number | null>(null);
  const [showPageSizeModal, setShowPageSizeModal] = useState(false);
  const [pageSizePreset, setPageSizePreset] = useState<PageSizePreset>('letter');
  const [showPrependModal, setShowPrependModal] = useState(false);
  const [prependFilePath, setPrependFilePath] = useState('');
  const [prependSourcePageCount, setPrependSourcePageCount] = useState<number | null>(null);
  const [showSplitEveryModal, setShowSplitEveryModal] = useState(false);
  const [splitEveryN, setSplitEveryN] = useState(2);
  const [showPageBorderModal, setShowPageBorderModal] = useState(false);
  const [pageBorderInset, setPageBorderInset] = useState(20);
  const [showBookmarkAllModal, setShowBookmarkAllModal] = useState(false);
  const [bookmarkAllPrefix, setBookmarkAllPrefix] = useState('Page ');
  const [showExtractOddModal, setShowExtractOddModal] = useState(false);
  const [extractOddOutputPath, setExtractOddOutputPath] = useState('');
  const [showExtractEvenModal, setShowExtractEvenModal] = useState(false);
  const [extractEvenOutputPath, setExtractEvenOutputPath] = useState('');
  const [showSplitAtModal, setShowSplitAtModal] = useState(false);
  const [splitAtPage, setSplitAtPage] = useState(1);
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertFilePath, setInsertFilePath] = useState<string>('');
  const [insertAtPage, setInsertAtPage] = useState<number>(0);
  const [insertSourcePageCount, setInsertSourcePageCount] = useState<number | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeFilePath, setMergeFilePath] = useState('');
  const [mergeSourcePageCount, setMergeSourcePageCount] = useState<number | null>(null);

  return {
    showSplitModal, setShowSplitModal,
    splitRanges, setSplitRanges,
    showExtractModal, setShowExtractModal,
    extractOutputPath, setExtractOutputPath,
    showExportPngModal, setShowExportPngModal,
    pngExportOutputPath, setPngExportOutputPath,
    imageExportFormat, setImageExportFormat,
    showReplacePageModal, setShowReplacePageModal,
    replaceSourcePath, setReplaceSourcePath,
    replaceSourcePage, setReplaceSourcePage,
    replaceSourcePageCount, setReplaceSourcePageCount,
    showInterleaveModal, setShowInterleaveModal,
    interleaveFilePath, setInterleaveFilePath,
    interleaveSourcePageCount, setInterleaveSourcePageCount,
    showPageSizeModal, setShowPageSizeModal,
    pageSizePreset, setPageSizePreset,
    showPrependModal, setShowPrependModal,
    prependFilePath, setPrependFilePath,
    prependSourcePageCount, setPrependSourcePageCount,
    showSplitEveryModal, setShowSplitEveryModal,
    splitEveryN, setSplitEveryN,
    showPageBorderModal, setShowPageBorderModal,
    pageBorderInset, setPageBorderInset,
    showBookmarkAllModal, setShowBookmarkAllModal,
    bookmarkAllPrefix, setBookmarkAllPrefix,
    showExtractOddModal, setShowExtractOddModal,
    extractOddOutputPath, setExtractOddOutputPath,
    showExtractEvenModal, setShowExtractEvenModal,
    extractEvenOutputPath, setExtractEvenOutputPath,
    showSplitAtModal, setShowSplitAtModal,
    splitAtPage, setSplitAtPage,
    showInsertModal, setShowInsertModal,
    insertFilePath, setInsertFilePath,
    insertAtPage, setInsertAtPage,
    insertSourcePageCount, setInsertSourcePageCount,
    showMergeModal, setShowMergeModal,
    mergeFilePath, setMergeFilePath,
    mergeSourcePageCount, setMergeSourcePageCount,
  };
}
