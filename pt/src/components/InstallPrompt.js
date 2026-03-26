import useInstallPrompt from './useInstallPrompt';

const CONTENT = {
  en: {
    // iOS Safari
    'ios-safari': {
      heading:  'Add to your home screen',
      subtitle: 'Install Storyboard for quick access',
      steps: [
        'Tap the Share button ↑ in the Safari toolbar',
        'Tap "Add to Home Screen"',
        'Tap Add to confirm',
      ],
    },
    // iOS Chrome/Firefox/others
    'ios-other': {
      heading:  'Install via Safari',
      subtitle: 'PWA install is only available in Safari on iPhone/iPad',
      steps: [
        'Open Safari on your device',
        'Visit this same page',
        'Tap Share ↑ then "Add to Home Screen"',
      ],
    },
    // Mac Safari 17+
    'mac-safari-17': {
      heading:  'Add to your Dock',
      subtitle: 'Install Storyboard as a Mac app',
      steps: [
        'In the Safari menu bar, click File',
        'Click "Add to Dock..."',
        'Click Add to confirm',
      ],
    },
    // Chrome / Edge (native prompt)
    chromium: {
      heading:  'Add Storyboard to your home screen',
      subtitle: 'One tap from your home screen — no browser needed.',
      steps:    null, // uses native prompt button
    },
    btnInstall: 'Install App',
    btnDismiss: 'Not now',
  },
  hi: {
    'ios-safari': {
      heading:  'होम स्क्रीन पर जोड़ें',
      subtitle: 'Storyboard को जल्दी एक्सेस करने के लिए इंस्टॉल करें',
      steps: [
        'Safari toolbar में शेयर बटन ↑ टैप करें',
        '"Add to Home Screen" टैप करें',
        'Add टैप करके confirm करें',
      ],
    },
    'ios-other': {
      heading:  'Safari में खोलें',
      subtitle: 'iPhone/iPad पर PWA install केवल Safari में उपलब्ध है',
      steps: [
        'अपने device पर Safari खोलें',
        'यही पेज visit करें',
        'Share ↑ फिर "Add to Home Screen" टैप करें',
      ],
    },
    'mac-safari-17': {
      heading:  'Dock में जोड़ें',
      subtitle: 'Storyboard को Mac app के रूप में इंस्टॉल करें',
      steps: [
        'Safari menu bar में File क्लिक करें',
        '"Add to Dock..." क्लिक करें',
        'Add क्लिक करके confirm करें',
      ],
    },
    chromium: {
      heading:  'Storyboard होम स्क्रीन पर जोड़ें',
      subtitle: 'होम स्क्रीन से एक टैप में — बिना ब्राउज़र के।',
      steps:    null,
    },
    btnInstall: 'इंस्टॉल करें',
    btnDismiss: 'अभी नहीं',
  },
};

export default function InstallPrompt({ lang, accent = '#d97706' }) {
  const {
    canShowPopup, platform, isInstalled,
    triggerInstall, dismissPopup, hasDeferredPrompt,
  } = useInstallPrompt();

  if (!canShowPopup || isInstalled) return null;
  if (!CONTENT[lang]?.[platform] && !CONTENT.en[platform]) return null;

  const c      = CONTENT[lang] || CONTENT.en;
  const info   = c[platform] || CONTENT.en[platform];
  const btnDismiss = c.btnDismiss;
  const btnInstall = c.btnInstall;

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      width: 'calc(100% - 32px)', maxWidth: 480, zIndex: 200,
      background: 'linear-gradient(160deg,#1a1408,#13100d)',
      border: `1px solid ${accent}55`, borderRadius: 20,
      padding: '20px 20px 16px',
      boxShadow: `0 8px 40px rgba(0,0,0,0.8), 0 0 0 1px ${accent}22`,
      animation: 'fadeUp 0.4s ease both',
    }}>
      <div style={{ height:2, background:`linear-gradient(90deg,transparent,${accent},transparent)`, marginBottom:16, borderRadius:2 }} />

      {/* Icon + heading */}
      <div style={{ display:'flex', gap:14, alignItems:'flex-start', marginBottom:14 }}>
        <img src="/icons/icon-72.png" alt="Storyboard"
          style={{ width:44, height:44, borderRadius:10, flexShrink:0 }}
          onError={e => e.currentTarget.style.display='none'} />
        <div>
          <div style={{ fontFamily:'var(--serif)', fontSize:'0.95rem', color:'#fef3c7', fontWeight:700, marginBottom:3 }}>
            {info.heading}
          </div>
          <div style={{ fontFamily:'var(--serif)', fontSize:'0.8rem', color:'#a89880', lineHeight:1.4 }}>
            {info.subtitle}
          </div>
        </div>
      </div>

      {/* Step-by-step instructions */}
      {info.steps && (
        <div style={{ marginBottom:14 }}>
          {info.steps.map((step, i) => (
            <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:7 }}>
              <div style={{ width:20, height:20, borderRadius:'50%', background:`${accent}33`, border:`1px solid ${accent}66`, color:accent, fontFamily:'var(--mono)', fontSize:'0.62rem', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontWeight:700 }}>
                {i + 1}
              </div>
              <div style={{ fontFamily:'var(--serif)', fontSize:'0.83rem', color:'#c4b090', lineHeight:1.5 }}>
                {step}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display:'flex', gap:10 }}>
        {platform === 'chromium' && hasDeferredPrompt && (
          <button onClick={triggerInstall}
            style={{ flex:1, padding:'10px 16px', borderRadius:24, background:`linear-gradient(135deg,${accent}cc,${accent}88)`, border:`1px solid ${accent}`, color:'#fff', fontFamily:'var(--mono)', fontSize:'0.75rem', fontWeight:700, letterSpacing:'0.06em', cursor:'pointer', transition:'opacity 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.opacity='0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity='1'}
          >{btnInstall}</button>
        )}
        <button onClick={dismissPopup}
          style={{ flex: (platform !== 'chromium' || !hasDeferredPrompt) ? 1 : 0, padding:'10px 16px', borderRadius:24, background:'none', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.4)', fontFamily:'var(--mono)', fontSize:'0.75rem', cursor:'pointer', transition:'all 0.2s', whiteSpace:'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.3)'; e.currentTarget.style.color='rgba(255,255,255,0.7)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.12)'; e.currentTarget.style.color='rgba(255,255,255,0.4)'; }}
        >{btnDismiss}</button>
      </div>
    </div>
  );
}
