import type { ReactNode } from 'react';

type SettingsCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function SettingsCard({ title, subtitle, children }: SettingsCardProps) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <h2 className="settings-card-title">{title}</h2>
        {subtitle && <p className="settings-card-subtitle">{subtitle}</p>}
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}
