// ─────────────────────────────────────────────────────────────
//  useInstallPrompt.js
//
//  Platform coverage:
//  iOS/iPadOS Safari          → 3-step Add to Home Screen
//  iOS/iPadOS other browsers  → "Open in Safari" guidance
//  Mac Safari 17+             → "File → Add to Dock" guidance
//  Mac/Win Chrome/Edge        → native beforeinstallprompt
//  Android Chrome/Samsung     → native beforeinstallprompt
//  Firefox (all platforms)    → nothing (no PWA support)
//
//  Two independent dismiss states:
//  pt_prompt_dismissed → hides post-story popup (retries after 3 days)
//  pt_footer_dismissed → hides footer button permanently (user taps ✕)
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';

const PROMPT_DISMISSED_KEY = 'pt_prompt_dismissed';
const FOOTER_DISMISSED_KEY = 'pt_footer_dismissed';
const INSTALLED_KEY        = 'pt_installed';
const RETRY_DAYS           = 3;

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function getPlatform() {
  const ua  = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mac = !ios && /macintosh|mac os x/i.test(ua);

  if (ios) {
    // Pure Safari on iOS: has Safari, no CriOS/FxiOS/EdgiOS
    const iosSafari = ua.includes('Safari') &&
      !ua.includes('CriOS') && !ua.includes('FxiOS') && !ua.includes('EdgiOS');
    return iosSafari ? 'ios-safari' : 'ios-other';
  }

  if (mac) {
    // Safari on Mac: has Safari but not Chrome string
    const macSafari = ua.includes('Safari') && !ua.includes('Chrome');
    if (macSafari) {
      // Safari 17+ supports PWA install (version string: Version/17.x)
      const match = ua.match(/Version\/(\d+)/);
      const ver   = match ? parseInt(match[1], 10) : 0;
      return ver >= 17 ? 'mac-safari-17' : 'mac-safari-old';
    }
    // Chrome or Edge on Mac
    if (ua.includes('Chrome') || ua.includes('Edg')) return 'chromium';
    return 'unsupported';
  }

  // Android or Windows
  const android = /android/i.test(ua);
  if (android) {
    if (ua.includes('Firefox')) return 'unsupported';
    return 'chromium'; // Chrome, Samsung Internet, Edge etc
  }

  // Windows / Linux
  if (ua.includes('Firefox')) return 'unsupported';
  if (ua.includes('Chrome') || ua.includes('Edg')) return 'chromium';
  return 'unsupported';
}

export default function useInstallPrompt() {
  const [deferredPrompt,  setDeferredPrompt]  = useState(null);
  const [canShowPopup,    setCanShowPopup]    = useState(false);
  const [canShowFooter,   setCanShowFooter]   = useState(false);
  const [platform,        setPlatform]        = useState('unknown');
  const [isInstalled,     setIsInstalled]     = useState(false);

  useEffect(() => {
    if (isInStandaloneMode()) {
      setIsInstalled(true);
      localStorage.setItem(INSTALLED_KEY, '1');
      return;
    }

    const p = getPlatform();
    setPlatform(p);

    const promptDismissed = localStorage.getItem(PROMPT_DISMISSED_KEY);
    const footerDismissed = localStorage.getItem(FOOTER_DISMISSED_KEY);

    const promptAllowed = !promptDismissed || (() => {
      const daysSince = (Date.now() - parseInt(promptDismissed, 10)) / 86400000;
      return daysSince >= RETRY_DAYS;
    })();

    if (p === 'unsupported' || p === 'mac-safari-old') return;

    // Platforms with static instructions (no JS event needed)
    if (['ios-safari', 'ios-other', 'mac-safari-17'].includes(p)) {
      if (!footerDismissed) setCanShowFooter(true);
      if (promptAllowed)    setCanShowPopup(true);
      return;
    }

    // Chromium — wait for beforeinstallprompt
    if (p === 'chromium') {
      if (!footerDismissed) setCanShowFooter(true);
      const handler = (e) => {
        e.preventDefault();
        setDeferredPrompt(e);
        if (promptAllowed) setCanShowPopup(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      window.addEventListener('appinstalled', () => {
        setIsInstalled(true);
        setCanShowPopup(false);
        setCanShowFooter(false);
        localStorage.setItem(INSTALLED_KEY, '1');
      });
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      localStorage.setItem(INSTALLED_KEY, '1');
    }
    setDeferredPrompt(null);
    setCanShowPopup(false);
  };

  const dismissPopup = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, Date.now().toString());
    setCanShowPopup(false);
  };

  const dismissFooter = () => {
    localStorage.setItem(FOOTER_DISMISSED_KEY, '1');
    setCanShowFooter(false);
  };

  return {
    canShowPopup,
    canShowFooter,
    platform,
    isInstalled,
    triggerInstall,
    dismissPopup,
    dismissFooter,
    hasDeferredPrompt: !!deferredPrompt,
  };
}
