import { createTranslator } from '@labpass/i18n';

const t = createTranslator('en');

export function App() {
  const info = window.labpass?.appInfo();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg text-text">
      <p className="font-mono text-sm text-text-muted">{info ? `${info.name} ${info.version}` : 'LabPass Kiosk'}</p>
      <h1 className="font-display text-kiosk tracking-display">{t('kiosk.tapPrompt')}</h1>
      <p className="text-text-muted">Foundation scaffold (S02). Reader flow arrives in S11.</p>
    </main>
  );
}
