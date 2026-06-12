import { useState } from 'react';

export type RotateDirection = 'cw' | 'ccw';

export function useAppModalStateRotate() {
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [rotateDirection, setRotateDirection] = useState<RotateDirection>('cw');

  return {
    showRotateModal,
    setShowRotateModal,
    rotateDirection,
    setRotateDirection,
  };
}
