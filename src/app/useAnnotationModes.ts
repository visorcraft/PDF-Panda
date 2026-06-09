import type { Dispatch, SetStateAction } from 'react';
import { useAnnotationModesAsset } from './useAnnotationModesAsset';
import { useAnnotationModesMarkup } from './useAnnotationModesMarkup';
import type { UseAnnotationModesAssetOptions } from './useAnnotationModesAsset';

export type UseAnnotationModesOptions = UseAnnotationModesAssetOptions & {
  setShowFormsPanel: Dispatch<SetStateAction<boolean>>;
};

export function useAnnotationModes(opts: UseAnnotationModesOptions) {
  const asset = useAnnotationModesAsset(opts);
  const markup = useAnnotationModesMarkup(opts);
  return { ...asset, ...markup };
}
