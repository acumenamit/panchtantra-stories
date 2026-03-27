import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initAnalytics, POSTHOG_KEY } from './analytics';

// ── Arabic font (Noto Naskh Arabic) ────────────────────────────────────────
// Injected here so it loads early — before any Arabic text renders.
// The :lang(ar) CSS rule in index.css will activate it automatically.
(function () {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
})();

(function () {
  if (POSTHOG_KEY === 'YOUR_POSTHOG_KEY_HERE') {
    console.log('[Analytics] PostHog not configured — events will log to console only.');
    initAnalytics();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://eu-assets.i.posthog.com/static/array.js';
  script.async = true;
  script.onload = () => initAnalytics();
  document.head.appendChild(script);
})();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
