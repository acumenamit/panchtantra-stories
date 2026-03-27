import { useLang } from '../LangContext';

export default function LangToggle({ accent }) {
  const { lang, setLang } = useLang();

  const btn = (code, label) => {
    const active = lang === code;
    return (
      <button
        onClick={() => setLang(code)}
        style={{
          padding: '6px 14px',
          borderRadius: 20,
          border: active ? `1.5px solid ${accent || '#fbbf24'}` : '1.5px solid rgba(255,255,255,0.2)',
          background: active ? `${accent || '#fbbf24'}22` : 'rgba(255,255,255,0.04)',
          color: active ? (accent || '#fbbf24') : 'rgba(255,255,255,0.5)',
          // Use a system font stack here so the button label renders
          // correctly regardless of the current html[lang] override.
          // Noto Naskh Arabic covers the عربي label; the Latin fallback
          // covers "English". We avoid var(--mono) because Space Mono
          // has no Arabic glyphs.
          fontFamily: "'Noto Naskh Arabic', 'Lora', Georgia, serif",
          fontSize: '0.82rem',
          fontWeight: active ? 700 : 400,
          letterSpacing: code === 'ar' ? 0 : '0.06em',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          // Ensure button text always reads LTR inside an RTL page —
          // "English" should never appear right-to-left.
          direction: 'ltr',
          unicodeBidi: 'embed',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '4px',
      borderRadius: 24,
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      {btn('en', 'English')}
      {btn('ar', 'عربي')}
    </div>
  );
}
