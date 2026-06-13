import React from 'react';
import { useEscapeClose } from '../legal/useEscapeClose';
import { FocusTrap } from './FocusTrap';

type ModalProps = {
  children: React.ReactNode;
  onClose: () => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

export function Modal({ children, onClose, ...aria }: ModalProps) {
  useEscapeClose(onClose, true);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <FocusTrap>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          {...aria}
        >
          {children}
        </div>
      </FocusTrap>
    </div>
  );
}
