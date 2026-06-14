import React from 'react';
import { useEscapeClose } from '../legal/useEscapeClose';
import { FocusTrap } from './FocusTrap';

type ModalProps = {
  children: React.ReactNode;
  onClose: () => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
};

export function Modal({ children, onClose, 'data-testid': dataTestId, ...aria }: ModalProps) {
  useEscapeClose(onClose, true);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <FocusTrap>
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          data-testid={dataTestId}
          {...aria}
        >
          {children}
        </div>
      </FocusTrap>
    </div>
  );
}
