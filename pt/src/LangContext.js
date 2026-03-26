import { createContext, useContext, useState, useEffect } from 'react';

const LangContext = createContext();

export function LangProvider({ children }) {
  // Initialise from localStorage so language persists across sessions
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('pt_lang') || 'en'; }
    catch { return 'en'; }
  });

  // Persist language + keep <html lang> in sync
  useEffect(() => {
    try { localStorage.setItem('pt_lang', lang); } catch {}
    document.documentElement.lang = lang;
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
// node.text can be a string (legacy) or { en: '...', hi: '...' }
export function t(field, lang) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field[lang] || field['en'] || '';
}
