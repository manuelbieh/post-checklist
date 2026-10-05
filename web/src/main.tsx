import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { openStorage } from './lib/storage';
import { language } from './strings';
import './styles.css';

document.documentElement.lang = language;

const { storage, persistent } = openStorage();

// Home screen apps ask the browser not to evict their data under storage pressure.
if (persistent && matchMedia('(display-mode: standalone)').matches) {
  navigator.storage?.persist?.().catch(() => false);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App storage={storage} persistent={persistent} />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void registerServiceWorker());
}

async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    // A home screen app can stay open for days without navigating, so look for
    // updates when it comes back to the foreground.
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 30 * 60_000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    });
  } catch (error) {
    console.error('Post Check: service worker registration failed', error);
  }
}
