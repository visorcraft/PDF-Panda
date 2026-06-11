type SettingsPageProps = {
  closeSettings?: () => void;
  hasDocument?: boolean;
};

export function SettingsPage({ closeSettings, hasDocument }: SettingsPageProps) {
  return (
    <main className="settings-page" role="main" aria-label="Settings">
      <header className="settings-header">
        <div className="settings-header-content">
          <div>
            <h1 className="settings-title">Settings</h1>
            <p className="settings-subtitle">Preferences for PDF Panda.</p>
          </div>
          {closeSettings && (
            <button
              type="button"
              className="settings-back-button"
              onClick={closeSettings}
              data-testid="settings-back-button"
            >
              {hasDocument ? 'Back to document' : 'Back'}
            </button>
          )}
        </div>
      </header>
      <section className="settings-content">
        <p className="settings-placeholder">Settings options will appear here.</p>
      </section>
    </main>
  );
}
