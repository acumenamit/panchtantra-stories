import { createContext, useContext, useState, useEffect } from 'react';

const LangContext = createContext();

export function LangProvider({ children }) {
  // Initialise from localStorage so language persists across sessions
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('hk_lang') || 'en'; }
    catch { return 'en'; }
  });

  // Persist language + keep <html lang> and <html dir> in sync.
  // Setting dir here (rather than only in CSS) ensures screen readers,
  // browser chrome, and any third-party scripts also see the correct
  // text direction — CSS alone only affects visual rendering.
  useEffect(() => {
    try { localStorage.setItem('hk_lang', lang); } catch {}
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

// Helper — pick the right language string from a node field
// node.text can be a string (legacy) or { en: '...', ar: '...' }
export function t(field, lang) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field[lang] || field['en'] || '';
}
