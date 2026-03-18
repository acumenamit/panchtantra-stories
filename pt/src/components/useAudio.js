// ─────────────────────────────────────────────────────────────
//  useAudio.js
//  Browser Text-to-Speech hook using window.speechSynthesis
//  Supports English and Hindi natively on Chrome/Safari iPad
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';

// Pick the best available voice for a given language
function getBestVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const langCode = lang === 'hi' ? 'hi' : 'en';

  // Try to find a local (higher quality) voice first
  const local = voices.find(v =>
    v.lang.startsWith(langCode) && v.localService
  );
  if (local) return local;

  // Fall back to any matching voice
  const any = voices.find(v => v.lang.startsWith(langCode));
  if (any) return any;

  // Last resort — default voice
  return voices[0];
}

export default function useAudio() {
  const [isPlaying, setIsPlaying]   = useState(false);
  const [isSupported, setSupported] = useState(false);
  const utteranceRef = useRef(null);

  // Check browser support on mount and cancel on unmount
  useEffect(() => {
    setSupported('speechSynthesis' in window);
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = useCallback((text, lang = 'en') => {
    if (!window.speechSynthesis) return;

    // Cancel anything currently playing
    window.speechSynthesis.cancel();

    // Clean text — remove emoji and extra symbols for cleaner audio
    const clean = text
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/✦|←|↺|🌿|★/g, '')
      .trim();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang  = lang === 'hi' ? 'hi-IN' : 'en-IN'; // Indian English accent
    utterance.rate  = 0.88;   // slightly slower — easier for children
    utterance.pitch = 1.05;   // slightly warm
    utterance.volume = 1;

    // Assign best available voice
    const voice = getBestVoice(lang);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend   = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback((text, lang) => {
    if (isPlaying) {
      stop();
    } else {
      speak(text, lang);
    }
  }, [isPlaying, speak, stop]);

  return { isPlaying, isSupported, speak, stop, toggle };
}
