import type { ReactNode } from 'react';
import { useEscapeClose } from './useEscapeClose';

type LegalModalShellProps = {
  onClose: () => void;
  onEscape?: () => void;
  allowBackdropClose?: boolean;
  title: string;
  tagline: ReactNode;
  backdropClassName: string;
  panelClassName: string;
  headerClassName?: string;
  taglineClassName?: string;
  bodyClassName?: string;
  testId: string;
  children: ReactNode;
};

export function LegalModalShell({
  onClose,
  onEscape,
  allowBackdropClose = true,
  title,
  tagline,
  backdropClassName,
  panelClassName,
  headerClassName,
  taglineClassName,
  bodyClassName,
  testId,
  children,
}: LegalModalShellProps) {
  useEscapeClose(onEscape ?? onClose);

  const headerClass = headerClassName ? `legal-header ${headerClassName}` : 'legal-header';
  const taglineClass = taglineClassName ? `legal-tagline ${taglineClassName}` : 'legal-tagline';
  const bodyClass = bodyClassName ? `legal-body ${bodyClassName}` : 'legal-body';

  return (
    <div
      className={`modal-backdrop legal-backdrop ${backdropClassName}`}
      onClick={() => {
        if (allowBackdropClose) onClose();
      }}
    >
      <div
        className={`legal-page ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <header className={headerClass}>
          <div>
            <h2>{title}</h2>
            <p className={taglineClass}>{tagline}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary legal-close-btn"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
          >
            Close
          </button>
        </header>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  );
}
