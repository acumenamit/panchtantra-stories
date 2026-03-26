// ─────────────────────────────────────────────────────────────
//  useInstallPrompt.js
//  Handles PWA install prompt for both Android and iOS.
//
//  Android Chrome: intercepts beforeinstallprompt, defers it,
//  exposes trigger() to show the native prompt on demand.
//
//  iOS Safari: no beforeinstallprompt support — detects iOS
//  and returns isIOS:true so the UI can show manual instructions.
//
//  Storage key: 'pt_install_dismissed'
//  Once dismissed, never shows again.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';

const DISMISSED_KEY    = 'pt_install_dismissed';   // timestamp of last dismiss
const INSTALLED_KEY    = 'pt_installed';
const DISMISS_COUNT_KEY = 'pt_install_dismiss_count';
const RETRY_DAYS        = 3; // show again after this many days if dismissed once

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

export default function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [canPrompt,      setCanPrompt]      = useState(false);
  const [isIOSDevice,    setIsIOSDevice]    = useState(false);
  const [isInstalled,    setIsInstalled]    = useState(false);

  useEffect(() => {
    // Already installed — don't show
    if (isInStandaloneMode()) {
      setIsInstalled(true);
      localStorage.setItem(INSTALLED_KEY, '1');
      return;
    }

    // Check dismissal — allow retry after RETRY_DAYS, suppress after 2 dismissals
    const dismissedAt    = localStorage.getItem(DISMISSED_KEY);
    const dismissCount   = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10);
    if (dismissedAt) {
      if (dismissCount >= 2) return; // permanently suppressed
      const daysSince = (Date.now() - parseInt(dismissedAt, 10)) / 86400000;
      if (daysSince < RETRY_DAYS) return; // too soon to retry
    }

    // iOS — no beforeinstallprompt, show manual instructions
    if (isIOS()) {
      setIsIOSDevice(true);
      setCanPrompt(true);
      return;
    }

    // Android / Desktop Chrome — intercept native prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setCanPrompt(false);
      localStorage.setItem(INSTALLED_KEY, '1');
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const trigger = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setCanPrompt(false);
        localStorage.setItem(INSTALLED_KEY, '1');
      }
      setDeferredPrompt(null);
    }
  };

  const dismiss = () => {
    const count = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10);
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    localStorage.setItem(DISMISS_COUNT_KEY, (count + 1).toString());
    setCanPrompt(false);
  };

  return { canPrompt, isIOSDevice, isInstalled, trigger, dismiss };
}
