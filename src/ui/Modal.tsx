import React from 'react';
import { useEscapeClose } from '../legal/useEscapeClose';
import { FocusTrap } from './FocusTrap';

type ModalProps = {
  children: React.ReactNode;
  onClose: () => void;
};

export function Modal({ children, onClose }: ModalProps) {
  useEscapeClose(onClose, true);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <FocusTrap>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          {children}
        </div>
      </FocusTrap>
    </div>
  );
}
