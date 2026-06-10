import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Modal } from '../ui/Modal';

type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';

type UpdateModalProps = {
  onClose: () => void;
};

export function UpdateModal({ onClose }: UpdateModalProps) {
  const [phase, setPhase] = useState<UpdatePhase>('checking');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const runCheck = useCallback(async () => {
    setPhase('checking');
    setError('');
    try {
      const result = await check();
      if (!result) {
        setPhase('current');
        return;
      }
      setUpdate(result);
      setPhase('available');
    } catch (err) {
      setError(String(err));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const download = async () => {
    if (!update) return;
    setPhase('downloading');
    setProgress(0);
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Progress') {
          setProgress(event.data.chunkLength > 0 ? Math.min(99, progress + 1) : progress);
        }
      });
      setPhase('ready');
    } catch (err) {
      setError(String(err));
      setPhase('error');
    }
  };

  const restart = async () => {
    await relaunch();
  };

  return (
    <Modal onClose={onClose}>
      <h3>Check for Updates</h3>
      <div className="update-modal-body">
        {phase === 'checking' && <p>Checking for updates…</p>}
        {phase === 'current' && <p>PDF Panda is up to date.</p>}
        {phase === 'available' && update && (
          <>
            <p>
              Version <strong>{update.version}</strong> is available.
            </p>
            {update.body && <pre className="update-notes">{update.body}</pre>}
            <div className="modal-actions">
              <button type="button" onClick={() => void download()}>
                Download
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Later
              </button>
            </div>
          </>
        )}
        {phase === 'downloading' && <p>Downloading… {progress > 0 ? `${progress}%` : ''}</p>}
        {phase === 'ready' && (
          <div className="modal-actions">
            <button type="button" onClick={() => void restart()}>
              Restart Now
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Later
            </button>
          </div>
        )}
        {phase === 'error' && (
          <>
            <p className="error-text">{error || 'Update check failed.'}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => void runCheck()}>
                Retry
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export async function fetchUpdaterSupported(): Promise<boolean> {
  try {
    return await invoke<boolean>('updater_supported');
  } catch {
    return false;
  }
}
