import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// A hot update keeps the App state, including the ModelCore made with the old
// code, which would keep solving with it. Changes to the core reload the page;
// the model comes back from browser storage.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((u) => u.path.includes('/packages/model-core/'))) location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
