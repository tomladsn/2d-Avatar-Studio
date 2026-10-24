import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../editor/theme';
import { AudioSyncApp } from './AudioSyncApp';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <AudioSyncApp />
  </ThemeProvider>
);
