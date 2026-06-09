import type { useSecurityFormState } from './useSecurityFormState';
import type { useDocumentPanelsState } from './useDocumentPanelsState';
import type { useAppDocumentState } from './useAppDocumentState';
import type { useAppPageRanges } from './useAppPageRanges';

type SecurityState = ReturnType<typeof useSecurityFormState>;
type PanelsState = ReturnType<typeof useDocumentPanelsState>;
type DocumentState = ReturnType<typeof useAppDocumentState>;
type PageRangesState = ReturnType<typeof useAppPageRanges>;

export function securityPdfActionFields(s: SecurityState) {
  return {
    decryptPassword: s.decryptPassword,
    metadataAuthor: s.metadataAuthor,
    metadataCreator: s.metadataCreator,
    metadataKeywords: s.metadataKeywords,
    metadataProducer: s.metadataProducer,
    metadataSubject: s.metadataSubject,
    metadataTitle: s.metadataTitle,
    protectOwnerPassword: s.protectOwnerPassword,
    protectUserPassword: s.protectUserPassword,
    protectUserPasswordConfirm: s.protectUserPasswordConfirm,
    setDecryptPassword: s.setDecryptPassword,
    setMetadataAuthor: s.setMetadataAuthor,
    setMetadataCreationDate: s.setMetadataCreationDate,
    setMetadataCreator: s.setMetadataCreator,
    setMetadataKeywords: s.setMetadataKeywords,
    setMetadataModDate: s.setMetadataModDate,
    setMetadataProducer: s.setMetadataProducer,
    setMetadataSubject: s.setMetadataSubject,
    setMetadataTitle: s.setMetadataTitle,
    setPdfPasswordDraft: s.setPdfPasswordDraft,
    setPendingEncryptedPath: s.setPendingEncryptedPath,
    setProtectOwnerPassword: s.setProtectOwnerPassword,
    setProtectUserPassword: s.setProtectUserPassword,
    setProtectUserPasswordConfirm: s.setProtectUserPasswordConfirm,
    setShowDecryptModal: s.setShowDecryptModal,
    setShowMetadataModal: s.setShowMetadataModal,
    setShowPasswordModal: s.setShowPasswordModal,
    setShowProtectModal: s.setShowProtectModal,
    setShowSignModal: s.setShowSignModal,
    setSignCertPassword: s.setSignCertPassword,
    setSignCertPath: s.setSignCertPath,
    setSignLocation: s.setSignLocation,
    setSignReason: s.setSignReason,
    signCertPassword: s.signCertPassword,
    signCertPath: s.signCertPath,
    signLocation: s.signLocation,
    signReason: s.signReason,
  };
}

export function panelsPdfActionFields(p: PanelsState) {
  return {
    formDrafts: p.formDrafts,
    formFields: p.formFields,
    setShowFormsPanel: p.setShowFormsPanel,
    setShowSignaturesPanel: p.setShowSignaturesPanel,
  };
}

export function documentPdfActionFields(d: DocumentState) {
  return {
    currentPage: d.currentPage,
    filePath: d.filePath,
    markdownPath: d.markdownPath,
    markdownRevision: d.markdownRevision,
    markdownText: d.markdownText,
    originalPath: d.originalPath,
    pageCount: d.pageCount,
    pageInput: d.pageInput,
    pdfRevision: d.pdfRevision,
    setCurrentPage: d.setCurrentPage,
    setMarkdownOcrNotice: d.setMarkdownOcrNotice,
    setMarkdownPath: d.setMarkdownPath,
    setMarkdownRevision: d.setMarkdownRevision,
    setMarkdownText: d.setMarkdownText,
    setOriginalPath: d.setOriginalPath,
    setPageCount: d.setPageCount,
    setPageInput: d.setPageInput,
    setPdfRevision: d.setPdfRevision,
    setViewMode: d.setViewMode,
    viewMode: d.viewMode,
    zoom: d.zoom,
  };
}

export function pageRangesPdfActionFields(r: PageRangesState) {
  return {
    cropRange: r.cropRange,
    deleteRange: r.deleteRange,
    duplicateRange: r.duplicateRange,
    expandMarginsRange: r.expandMarginsRange,
    exportPagesPdfRange: r.exportPagesPdfRange,
    extractRange: r.extractRange,
    flattenRange: r.flattenRange,
    insertRange: r.insertRange,
    interleaveRange: r.interleaveRange,
    keepRange: r.keepRange,
    mergeRange: r.mergeRange,
    moveRange: r.moveRange,
    pageBorderRange: r.pageBorderRange,
    pageFooterRange: r.pageFooterRange,
    pageHeaderRange: r.pageHeaderRange,
    pageNumbersRange: r.pageNumbersRange,
    pageSizeRange: r.pageSizeRange,
    parityRange: r.parityRange,
    pngExportRange: r.pngExportRange,
    prependRange: r.prependRange,
    reverseRange: r.reverseRange,
    rotateRange: r.rotateRange,
    shrinkMarginsRange: r.shrinkMarginsRange,
    watermarkRange: r.watermarkRange,
  };
}
