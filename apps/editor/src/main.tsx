import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { claimSlot } from './slots';

// A hot update keeps the App state, including the ModelCore made with the old
// code, which would keep solving with it. Changes to the core reload the page;
// the model comes back from browser storage.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((u) => u.path.includes('/packages/model-core/'))) location.reload();
  });
}

// Each tab works in a storage slot of its own, so tabs with other models do not overwrite each other.
void claimSlot().then((slot) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App initialSlot={slot} />
    </StrictMode>,
  ),
);
