import { useState } from 'react';

export function useAppModalStateRange() {
  const [showDeleteRangeModal, setShowDeleteRangeModal] = useState(false);
  const [showDuplicateRangeModal, setShowDuplicateRangeModal] = useState(false);
  const [showKeepRangeModal, setShowKeepRangeModal] = useState(false);
  const [showMoveRangeModal, setShowMoveRangeModal] = useState(false);
  const [moveRangeToIndex, setMoveRangeToIndex] = useState(0);
  const [showExpandMarginsModal, setShowExpandMarginsModal] = useState(false);
  const [expandMarginTop, setExpandMarginTop] = useState(20);
  const [expandMarginRight, setExpandMarginRight] = useState(20);
  const [expandMarginBottom, setExpandMarginBottom] = useState(20);
  const [expandMarginLeft, setExpandMarginLeft] = useState(20);
  const [showShrinkMarginsModal, setShowShrinkMarginsModal] = useState(false);
  const [shrinkMarginTop, setShrinkMarginTop] = useState(20);
  const [shrinkMarginRight, setShrinkMarginRight] = useState(20);
  const [shrinkMarginBottom, setShrinkMarginBottom] = useState(20);
  const [shrinkMarginLeft, setShrinkMarginLeft] = useState(20);
  const [showDeleteNthModal, setShowDeleteNthModal] = useState(false);
  const [deleteNthValue, setDeleteNthValue] = useState(2);
  const [showReverseRangeModal, setShowReverseRangeModal] = useState(false);
  const [showInsertBlankPagesModal, setShowInsertBlankPagesModal] =
    useState(false);
  const [insertBlankCount, setInsertBlankCount] = useState(1);
  const [insertBlankAtIndex, setInsertBlankAtIndex] = useState(0);
  const [showCropRangeModal, setShowCropRangeModal] = useState(false);
  const [showParityRangeModal, setShowParityRangeModal] = useState(false);
  const [parityRangeCommand, setParityRangeCommand] = useState(
    'rotate_odd_pages_in_range'
  );
  const [parityRangeOutputPath, setParityRangeOutputPath] = useState('');

  return {
    showDeleteRangeModal,
    setShowDeleteRangeModal,
    showDuplicateRangeModal,
    setShowDuplicateRangeModal,
    showKeepRangeModal,
    setShowKeepRangeModal,
    showMoveRangeModal,
    setShowMoveRangeModal,
    moveRangeToIndex,
    setMoveRangeToIndex,
    showExpandMarginsModal,
    setShowExpandMarginsModal,
    expandMarginTop,
    setExpandMarginTop,
    expandMarginRight,
    setExpandMarginRight,
    expandMarginBottom,
    setExpandMarginBottom,
    expandMarginLeft,
    setExpandMarginLeft,
    showShrinkMarginsModal,
    setShowShrinkMarginsModal,
    shrinkMarginTop,
    setShrinkMarginTop,
    shrinkMarginRight,
    setShrinkMarginRight,
    shrinkMarginBottom,
    setShrinkMarginBottom,
    shrinkMarginLeft,
    setShrinkMarginLeft,
    showDeleteNthModal,
    setShowDeleteNthModal,
    deleteNthValue,
    setDeleteNthValue,
    showReverseRangeModal,
    setShowReverseRangeModal,
    showInsertBlankPagesModal,
    setShowInsertBlankPagesModal,
    insertBlankCount,
    setInsertBlankCount,
    insertBlankAtIndex,
    setInsertBlankAtIndex,
    showCropRangeModal,
    setShowCropRangeModal,
    showParityRangeModal,
    setShowParityRangeModal,
    parityRangeCommand,
    setParityRangeCommand,
    parityRangeOutputPath,
    setParityRangeOutputPath,
  };
}
