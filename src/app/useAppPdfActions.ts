import { useStructuralEdit } from '../pdf/useStructuralEdit';
import { useImageExportActions } from '../pdf/useImageExportActions';
import { usePdfModalOpeners } from '../pdf/usePdfModalOpeners';
import { useSinglePageEditActions } from '../pdf/useSinglePageEditActions';
import { useDuplicateRangeActions } from '../pdf/useDuplicateRangeActions';
import { usePageHeaderFooterActions } from '../pdf/usePageHeaderFooterActions';
import { useSwapReplaceInterleaveActions } from '../pdf/useSwapReplaceInterleaveActions';
import { usePageSizeActions } from '../pdf/usePageSizeActions';
import { useExportPagesActions } from '../pdf/useExportPagesActions';
import { useParityExportActions } from '../pdf/useParityExportActions';
import { useRangeModalActions } from '../pdf/useRangeModalActions';
import { useOddEvenPageActions } from '../pdf/useOddEvenPageActions';
import { useOddEvenExtendedActions } from '../pdf/useOddEvenExtendedActions';
import { useSplitExtractPrependActions } from '../pdf/useSplitExtractPrependActions';
import { usePageDecorActions } from '../pdf/usePageDecorActions';
import { useBookmarkActions } from '../pdf/useBookmarkActions';
import { usePdfFileOpsActions } from '../pdf/usePdfFileOpsActions';
import { usePageDuplicateActions } from '../pdf/usePageDuplicateActions';
import { useFormFieldActions } from '../pdf/useFormFieldActions';
import { usePdfRevisionSync } from './usePdfRevisionSync';
import { usePageInteraction } from '../viewer/usePageInteraction';
import { useAnnotationModes } from './useAnnotationModes';
import { usePageTextEdits } from './usePageTextEdits';
import { useNotePasswordActions } from '../pdf/useNotePasswordActions';
import { useNativeFilePickers } from './useNativeFilePickers';
import { useSaveActions } from '../pdf/useSaveActions';
import { useMarkdownFlow } from './useMarkdownFlow';
import { useSecurityDocumentActions } from '../pdf/useSecurityDocumentActions';

type HookOpts<H extends (...args: never) => unknown> = Parameters<H>[0];

type AllHookOpts =
  & HookOpts<typeof usePdfModalOpeners>
  & HookOpts<typeof useImageExportActions>
  & HookOpts<typeof useStructuralEdit>
  & HookOpts<typeof useSinglePageEditActions>
  & HookOpts<typeof useDuplicateRangeActions>
  & HookOpts<typeof usePageHeaderFooterActions>
  & HookOpts<typeof useSwapReplaceInterleaveActions>
  & HookOpts<typeof usePageSizeActions>
  & HookOpts<typeof useExportPagesActions>
  & HookOpts<typeof useParityExportActions>
  & HookOpts<typeof useRangeModalActions>
  & HookOpts<typeof useOddEvenPageActions>
  & HookOpts<typeof useOddEvenExtendedActions>
  & HookOpts<typeof useSplitExtractPrependActions>
  & HookOpts<typeof usePageDecorActions>
  & HookOpts<typeof useBookmarkActions>
  & HookOpts<typeof usePdfFileOpsActions>
  & HookOpts<typeof usePageDuplicateActions>
  & HookOpts<typeof useFormFieldActions>
  & HookOpts<typeof usePdfRevisionSync>
  & HookOpts<typeof usePageInteraction>
  & HookOpts<typeof useAnnotationModes>
  & HookOpts<typeof usePageTextEdits>
  & HookOpts<typeof useNotePasswordActions>
  & HookOpts<typeof useNativeFilePickers>
  & HookOpts<typeof useSaveActions>
  & HookOpts<typeof useMarkdownFlow>
  & HookOpts<typeof useSecurityDocumentActions>;

export type UseAppPdfActionsInput = Omit<
  AllHookOpts,
  | 'runEdit'
  | 'defaultExtractOutputPath'
  | 'defaultImageExportOutput'
  | 'saveAsViaNativeDialog'
  | 'exitNoteMode'
  | 'refreshAnnotations'
> & {
  cancelDrawingRef: { current: () => void };
  handleSaveRef: { current: () => void | Promise<void> };
  handleMarkdownViewRef: { current: () => void | Promise<void> };
};

function call<H extends (opts: never) => unknown>(hook: H, input: object): ReturnType<H> {
  return hook(input as Parameters<H>[0]) as ReturnType<H>;
}

export function useAppPdfActions(input: UseAppPdfActionsInput) {
  const modalOpeners = call(usePdfModalOpeners, input);
  const imageExport = call(useImageExportActions, input);
  const runEdit = call(useStructuralEdit, input);
  const singlePage = call(useSinglePageEditActions, { ...input, runEdit });
  const duplicateRange = call(useDuplicateRangeActions, { ...input, runEdit });
  const headerFooter = call(usePageHeaderFooterActions, { ...input, runEdit });
  const swapReplace = call(useSwapReplaceInterleaveActions, { ...input, runEdit });
  const pageSize = call(usePageSizeActions, { ...input, runEdit });
  const exportPages = call(useExportPagesActions, input);
  const parityExport = call(useParityExportActions, { ...input, runEdit });
  const rangeModals = call(useRangeModalActions, { ...input, runEdit });
  const oddEven = call(useOddEvenPageActions, { ...input, runEdit });
  const oddEvenExt = call(useOddEvenExtendedActions, { ...input, runEdit });
  const splitExtract = call(useSplitExtractPrependActions, { ...input, runEdit });
  const pageDecor = call(usePageDecorActions, { ...input, runEdit });
  const bookmarkActions = call(useBookmarkActions, { ...input, runEdit });
  const fileOps = call(usePdfFileOpsActions, input);
  const pageDuplicate = call(usePageDuplicateActions, { ...input, runEdit });
  const formField = call(useFormFieldActions, input);
  call(usePdfRevisionSync, input);
  input.cancelDrawingRef.current = input.cancelDrawing;
  const pageInteraction = call(usePageInteraction, { ...input, runEdit });
  const annotationModes = call(useAnnotationModes, input);
  const pageTextEdits = call(usePageTextEdits, input);
  const nativePickers = call(useNativeFilePickers, {
    ...input,
    defaultExtractOutputPath: modalOpeners.defaultExtractOutputPath,
    defaultImageExportOutput: imageExport.defaultImageExportOutput,
  });
  const saveActions = call(useSaveActions, { ...input, saveAsViaNativeDialog: nativePickers.saveAsViaNativeDialog });
  const notePassword = call(useNotePasswordActions, {
    ...input,
    refreshAnnotations: pageInteraction.refreshAnnotations,
    exitNoteMode: annotationModes.exitNoteMode,
  });
  input.handleSaveRef.current = saveActions.handleSave;
  const markdownFlow = call(useMarkdownFlow, input);
  input.handleMarkdownViewRef.current = markdownFlow.handleMarkdownView;
  const securityDocs = call(useSecurityDocumentActions, { ...input, runEdit });

  return {
    runEdit,
    ...modalOpeners,
    ...imageExport,
    ...singlePage,
    ...duplicateRange,
    ...headerFooter,
    ...swapReplace,
    ...pageSize,
    ...exportPages,
    ...parityExport,
    ...rangeModals,
    ...oddEven,
    ...oddEvenExt,
    ...splitExtract,
    ...pageDecor,
    ...bookmarkActions,
    ...fileOps,
    ...pageDuplicate,
    applyFormField: formField.applyFormField,
    ...pageInteraction,
    ...annotationModes,
    ...pageTextEdits,
    ...notePassword,
    ...nativePickers,
    ...saveActions,
    ...markdownFlow,
    ...securityDocs,
  };
}
