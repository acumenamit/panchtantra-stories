// ─────────────────────────────────────────────────────────────
//  useInstallPrompt.js
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';

const DISMISSED_KEY     = 'pt_install_dismissed';
const INSTALLED_KEY     = 'pt_installed';
const DISMISS_COUNT_KEY = 'pt_install_dismiss_count';
const RETRY_DAYS        = 3;

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

// Only true Safari on iOS — NOT Chrome or other browsers on iOS
function isIOSSafariOnly() {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Chrome on iOS includes 'CriOS', Firefox includes 'FxiOS'
  // Pure Safari has neither
  const isSafari = isIOS && !ua.includes('CriOS') && !ua.includes('FxiOS')
    && !ua.includes('EdgiOS') && ua.includes('Safari');
  return isSafari;
}

export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [canPrompt,      setCanPrompt]      = useState(false);
  const [isIOSDevice,    setIsIOSDevice]    = useState(false);
  const [isInstalled,    setIsInstalled]    = useState(false);

  useEffect(() => {
    // Already running as installed PWA
    if (isInStandaloneMode()) {
      setIsInstalled(true);
      localStorage.setItem(INSTALLED_KEY, '1');
      return;
    }

    // Check dismissal history
    const dismissedAt  = localStorage.getItem(DISMISSED_KEY);
    const dismissCount = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10);
    if (dismissedAt && dismissCount >= 2) return; // permanently suppressed
    if (dismissedAt) {
      const daysSince = (Date.now() - parseInt(dismissedAt, 10)) / 86400000;
      if (daysSince < RETRY_DAYS) return; // too soon to retry
    }

    // iOS Safari — must show manual instructions
    if (isIOSSafariOnly()) {
      setIsIOSDevice(true);
      setCanPrompt(true);
      return;
    }

    // Chrome / Edge / other — wait for beforeinstallprompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setCanPrompt(false);
      setDeferredPrompt(null);
      localStorage.setItem(INSTALLED_KEY, '1');
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const trigger = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setCanPrompt(false);
      localStorage.setItem(INSTALLED_KEY, '1');
    }
    // Whether accepted or rejected, clear the prompt
    setDeferredPrompt(null);
    setCanPrompt(false);
  };

  const dismiss = () => {
    const count = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10);
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    localStorage.setItem(DISMISS_COUNT_KEY, (count + 1).toString());
    setCanPrompt(false);
  };

  return { canPrompt, isIOSDevice, isInstalled, trigger, dismiss };
}
