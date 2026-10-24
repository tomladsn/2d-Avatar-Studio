import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../editor/i18n';
import { ThemeProvider } from '../editor/theme';
import { LiveApp } from './LiveApp';
import './live.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <I18nProvider>
      <LiveApp />
    </I18nProvider>
  </ThemeProvider>
);
