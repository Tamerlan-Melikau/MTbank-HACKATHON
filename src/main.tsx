import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initTheme } from './app/theme';
import './ui/theme/tokens.css';
import './ui/theme/base.css';
import './ui/kit.css';

initTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
