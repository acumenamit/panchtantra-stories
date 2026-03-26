import useInstallPrompt from './useInstallPrompt';

const CONTENT = {
  en: {
    heading:     'Add Storyboard to your home screen',
    body:        'Read stories anytime — one tap from your home screen, no browser needed.',
    btnInstall:  'Add to Home Screen',
    btnDismiss:  'Not now',
    // iOS manual instructions
    iosHeading:  'Add to your home screen',
    iosStep1:    'Tap the Share button',
    iosStep2:    'Scroll down and tap "Add to Home Screen"',
    iosStep3:    'Tap Add',
    iosShareHint:'↑ tap the share icon in your browser bar',
  },
  hi: {
    heading:     'Storyboard को होम स्क्रीन पर जोड़ें',
    body:        'कभी भी कहानियाँ पढ़ें — होम स्क्रीन से एक टैप में, बिना ब्राउज़र के।',
    btnInstall:  'होम स्क्रीन पर जोड़ें',
    btnDismiss:  'अभी नहीं',
    iosHeading:  'होम स्क्रीन पर जोड़ें',
    iosStep1:    'शेयर बटन टैप करें',
    iosStep2:    '"Add to Home Screen" पर टैप करें',
    iosStep3:    'Add टैप करें',
    iosShareHint:'↑ ब्राउज़र बार में शेयर आइकन टैप करें',
  },
};

export default function InstallPrompt({ lang, accent = '#d97706' }) {
  const { canPrompt, isIOSDevice, isInstalled, trigger, dismiss } = useInstallPrompt();

  if (!canPrompt || isInstalled) return null;

  const c = CONTENT[lang] || CONTENT.en;

  return (
    <div style={{
      position: 'fixed',
      bottom: 80, // above sticky footer
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'calc(100% - 32px)',
      maxWidth: 480,
      zIndex: 200,
      background: 'linear-gradient(160deg,#1a1408,#13100d)',
      border: `1px solid ${accent}55`,
      borderRadius: 20,
      padding: '20px 20px 16px',
      boxShadow: `0 8px 40px rgba(0,0,0,0.8), 0 0 0 1px ${accent}22`,
      animation: 'fadeUp 0.4s ease both',
    }}>
      {/* Accent line */}
      <div style={{ height: 2, background: `linear-gradient(90deg,transparent,${accent},transparent)`, marginBottom: 16, borderRadius: 2 }} />

      {/* App icon + text */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
        <img
          src="/icons/icon-72.png"
          alt="Storyboard"
          style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0 }}
          onError={e => e.currentTarget.style.display = 'none'}
        />
        <div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '0.95rem', color: '#fef3c7', fontWeight: 700, marginBottom: 4 }}>
            {isIOSDevice ? c.iosHeading : c.heading}
          </div>
          {!isIOSDevice && (
            <div style={{ fontFamily: 'var(--serif)', fontSize: '0.82rem', color: '#a89880', lineHeight: 1.5 }}>
              {c.body}
            </div>
          )}
        </div>
      </div>

      {/* iOS instructions */}
      {isIOSDevice && (
        <div style={{ marginBottom: 16 }}>
          {[c.iosStep1, c.iosStep2, c.iosStep3].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: `${accent}33`, border: `1px solid ${accent}66`, color: accent, fontFamily: 'var(--mono)', fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700 }}>
                {i + 1}
              </div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '0.85rem', color: '#c4b090', lineHeight: 1.5 }}>
                {step}
              </div>
            </div>
          ))}
          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: accent, letterSpacing: '0.06em', marginTop: 10, textAlign: 'center' }}>
            {c.iosShareHint}
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        {!isIOSDevice && (
          <button
            onClick={trigger}
            style={{ flex: 1, padding: '10px 16px', borderRadius: 24, background: `linear-gradient(135deg,${accent}cc,${accent}88)`, border: `1px solid ${accent}`, color: '#fff', fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', transition: 'opacity 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            {c.btnInstall}
          </button>
        )}
        <button
          onClick={dismiss}
          style={{ flex: isIOSDevice ? 1 : 0, padding: '10px 16px', borderRadius: 24, background: 'none', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--mono)', fontSize: '0.75rem', cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
        >
          {c.btnDismiss}
        </button>
      </div>
    </div>
  );
}
