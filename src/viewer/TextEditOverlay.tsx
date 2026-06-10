import { useEffect, useRef } from 'react';
import type { PageTextRun } from '../pdf/useTextLayerLoader';

type TextEditOverlayProps = {
  run: PageTextRun;
  zoom: number;
  draft: string;
  onDraftChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
};

export function TextEditOverlay({
  run,
  zoom,
  draft,
  onDraftChange,
  onApply,
  onCancel,
}: TextEditOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [run.text]);

  return (
    <input
      ref={inputRef}
      type="text"
      className="text-edit-overlay-input"
      value={draft}
      style={{
        position: 'absolute',
        left: run.x,
        top: run.y,
        width: run.w,
        height: run.h,
        fontSize: run.h * 0.85,
        transform: `scale(${zoom})`,
        transformOrigin: 'top left',
      }}
      onChange={(e) => onDraftChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onApply();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onApply}
    />
  );
}
