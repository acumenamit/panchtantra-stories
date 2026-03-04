import { useLang } from '../LangContext';

export default function LangToggle({ accent }) {
  const { lang, setLang } = useLang();

  const btn = (code, label, flag) => {
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
          fontFamily: 'var(--mono)',
          fontSize: '0.72rem',
          fontWeight: active ? 700 : 400,
          letterSpacing: '0.06em',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span style={{ fontSize: '1rem' }}>{flag}</span>
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
      {btn('en', 'English', '🇬🇧')}
      {btn('hi', 'हिन्दी', '🇮🇳')}
    </div>
  );
}
