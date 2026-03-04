import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initAnalytics, POSTHOG_KEY, POSTHOG_HOST } from './analytics';

// Inject PostHog script then initialise
// (this avoids adding an npm package — works perfectly via CDN)
(function () {
  if (POSTHOG_KEY === 'phc_dFZKOQtPKbnfeGqRB6uAIYgxOYpv687X3b2vCxTJcFb') {
    console.log('[Analytics] PostHog not configured — events will log to console only.');
    initAnalytics();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.posthog.com/array/1.30.0/array.full.js';
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
