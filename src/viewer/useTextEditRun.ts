import { useCallback, useState } from 'react';
import type { createStructuralEditRunner } from '../pdf/runStructuralEdit';
import type { PageTextRun } from '../pdf/useTextLayerLoader';

type UseTextEditRunOptions = {
  filePath: string;
  currentPage: number;
  editTextRunMode: boolean;
  runEdit: ReturnType<typeof createStructuralEditRunner>;
};

export function useTextEditRun(opts: UseTextEditRunOptions) {
  const [activeRun, setActiveRun] = useState<PageTextRun | null>(null);
  const [draft, setDraft] = useState('');

  const hitTestRun = useCallback(
    (runs: PageTextRun[], x: number, y: number): PageTextRun | null => {
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        const run = runs[i]!;
        if (x >= run.x && x <= run.x + run.w && y >= run.y && y <= run.y + run.h) {
          return run;
        }
      }
      return null;
    },
    [],
  );

  const openRunEditor = useCallback((run: PageTextRun) => {
    setActiveRun(run);
    setDraft(run.text);
  }, []);

  const cancelEdit = useCallback(() => {
    setActiveRun(null);
    setDraft('');
  }, []);

  const applyEdit = useCallback(() => {
    if (!opts.filePath || !activeRun || !draft.trim()) {
      cancelEdit();
      return;
    }
    const run = activeRun;
    const text = draft.trim();
    cancelEdit();
    void opts.runEdit({
      command: 'replace_text_region',
      args: {
        path: opts.filePath,
        pageIndex: opts.currentPage,
        x: run.x,
        y: run.y,
        w: run.w,
        h: run.h,
        newText: text,
        fontSize: run.h * 0.85,
      },
      reloadAt: opts.currentPage,
      toast: 'Text replaced',
    });
  }, [activeRun, cancelEdit, draft, opts]);

  return {
    activeRun: opts.editTextRunMode ? activeRun : null,
    draft,
    setDraft,
    hitTestRun,
    openRunEditor,
    cancelEdit,
    applyEdit,
  };
}
