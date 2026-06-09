import { useState } from 'react';
import type { FormFieldData, PdfBookmarkEntry, PdfSignatureInfo, PdfSignatureVerificationSummary } from './types';

export function useDocumentPanelsState() {
  const [showSignaturesPanel, setShowSignaturesPanel] = useState(false);
  const [pdfSignatures, setPdfSignatures] = useState<PdfSignatureInfo[]>([]);
  const [signatureVerification, setSignatureVerification] = useState<PdfSignatureVerificationSummary | null>(null);
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false);
  const [pdfBookmarks, setPdfBookmarks] = useState<PdfBookmarkEntry[]>([]);
  const [showFormsPanel, setShowFormsPanel] = useState(false);
  const [formFields, setFormFields] = useState<FormFieldData[]>([]);
  const [formDrafts, setFormDrafts] = useState<Record<string, string>>({});

  return {
    showSignaturesPanel, setShowSignaturesPanel,
    pdfSignatures, setPdfSignatures,
    signatureVerification, setSignatureVerification,
    showBookmarksPanel, setShowBookmarksPanel,
    pdfBookmarks, setPdfBookmarks,
    showFormsPanel, setShowFormsPanel,
    formFields, setFormFields,
    formDrafts, setFormDrafts,
  };
}
