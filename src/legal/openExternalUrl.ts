import { invoke } from '@tauri-apps/api/core';

export function openExternalUrl(url: string): void {
  if (!url) return;
  void invoke('open_external_url', { url }).catch(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}
