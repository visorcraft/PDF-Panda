import { useCallback, useState } from 'react';

export type AppSurface = 'document' | 'settings';
export type SettingsFocusSection = 'appearance' | 'shortcuts' | null;

type SurfaceState = {
  activeSurface: AppSurface;
  settingsFocus: SettingsFocusSection;
  openSettings: (focus?: SettingsFocusSection) => void;
  closeSettings: () => void;
};

export function useAppSurfaceState(): SurfaceState {
  const [activeSurface, setActiveSurface] = useState<AppSurface>('document');
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocusSection>(null);

  const openSettings = useCallback((focus: SettingsFocusSection = null) => {
    setSettingsFocus(focus);
    setActiveSurface('settings');
  }, []);

  const closeSettings = useCallback(() => {
    setActiveSurface('document');
  }, []);

  return { activeSurface, settingsFocus, openSettings, closeSettings };
}
