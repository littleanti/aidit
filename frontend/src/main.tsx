// Aidit — MIT License. See LICENSE.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
// Side-effect import: langStore's module-init applies the persisted/derived
// language onto <html lang> at startup (index.html ships a static lang="ko").
import './stores/langStore';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
