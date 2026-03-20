import { createContext, useContext, useState, useEffect } from 'react';

const LangContext = createContext();

export function LangProvider({ children }) {
  const [lang, setLang] = useState('en'); // 'en' | 'hi'

  // Keep <html lang="..."> in sync — lets CSS :lang(hi) selector
  // apply Noto Sans Devanagari globally to every component at once
  useEffect(() => {
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
