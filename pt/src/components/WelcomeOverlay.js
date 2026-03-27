import { useState, useEffect } from 'react';
import { useLang } from '../LangContext';

const STORAGE_KEY = 'hk_welcomed';

const CONTENT = {
  en: {
    badge:   '✦ WELCOME TO PANCHATANTRA ✦',
    heading: 'Stories that make children think',
    points: [
      { icon: '🌿', title: 'Ancient wisdom',      body: 'Tales written 2,000 years ago — still the sharpest lessons in living wisely.' },
      { icon: '🤔', title: 'Your child chooses',  body: 'Every story branches. Children make the decisions and feel the consequences.' },
      { icon: '🇮🇳', title: 'Hindi & English',    body: 'Switch languages mid-story. Read together or let them read alone.' },
    ],
    cta:  'Start reading →',
    skip: 'Skip',
  },
  hi: {
    badge:   '✦ पञ्चतन्त्र में आपका स्वागत है ✦',
    heading: 'कहानियाँ जो बच्चों को सोचने पर मजबूर करें',
    points: [
      { icon: '🌿', title: 'प्राचीन ज्ञान',        body: '२,००० साल पहले लिखी गई कहानियाँ — बुद्धिमान जीवन के सबसे तेज़ पाठ।' },
      { icon: '🤔', title: 'बच्चा चुनाव करता है',   body: 'हर कहानी में मोड़ हैं। बच्चे फैसले लेते हैं और परिणाम महसूस करते हैं।' },
      { icon: '🇮🇳', title: 'हिन्दी और अंग्रेज़ी', body: 'कहानी के बीच में भाषा बदलें। साथ पढ़ें या अकेले पढ़ने दें।' },
    ],
    cta:  'पढ़ना शुरू करें →',
    skip: 'छोड़ें',
  },
  ar: {
    badge:   '✦ أهلاً بك في حكايات ✦',
    heading: 'قصص تجعل الأطفال يفكرون',
    points: [
      { icon: '🌿', title: 'حكمة قديمة',      body: 'حكايات كُتبت منذ آلاف السنين — لا تزال أعمق دروس الحياة الحكيمة.' },
      { icon: '🤔', title: 'طفلك يختار',       body: 'كل قصة تتفرّع. الأطفال يتخذون القرارات ويشعرون بالنتائج.' },
      { icon: '🌙', title: 'عربي وإنجليزي',   body: 'بدّل اللغة في منتصف القصة. اقرأ معاً أو دعهم يقرأون وحدهم.' },
    ],
    cta:  'ابدأ القراءة ←',
    skip: 'تخطّ',
  },
};

// ── Language picker step ──────────────────────────────────────
function LangStep({ onPick }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 20 }}>📚</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: '#d97706', letterSpacing: '0.18em', marginBottom: 16 }}>
        ✦ PANCHATANTRA ✦ पञ्चतन्त्र ✦
      </div>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.2rem,4vw,1.6rem)', color: '#fef3c7', fontWeight: 700, lineHeight: 1.3, marginBottom: 10 }}>
        Choose your language
      </h2>
      <p style={{ fontFamily: 'var(--serif)', fontSize: '1rem', color: '#a89880', marginBottom: 8 }}>
        اختر لغتك
      </p>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '20px 0' }} />

      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        {/* English */}
        <button
          onClick={() => onPick('en')}
          style={{ flex: 1, minWidth: 140, padding: '18px 20px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(217,119,6,0.12)'; e.currentTarget.style.borderColor = '#d97706'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
        >
          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: '#fef3c7', fontWeight: 700, marginBottom: 4 }}>English</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '0.8rem', color: '#a89880' }}>Continue in English</div>
        </button>

        {/* Arabic */}
        <button
          onClick={() => onPick('ar')}
          style={{ flex: 1, minWidth: 140, padding: '18px 20px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(217,119,6,0.12)'; e.currentTarget.style.borderColor = '#d97706'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
        >
          <div style={{ fontFamily: "'Noto Naskh Arabic', serif", fontSize: '1.1rem', color: '#fef3c7', fontWeight: 700, marginBottom: 4 }}>عربي</div>
          <div style={{ fontFamily: "'Noto Naskh Arabic', serif", fontSize: '0.85rem', color: '#a89880' }}>تابع بالعربية</div>
        </button>
      </div>
    </div>
  );
}

// ── Welcome content step ──────────────────────────────────────
function WelcomeStep({ lang, onDismiss }) {
  const c = CONTENT[lang] || CONTENT.en;
  return (
    <div>
      <div style={{ height: 2, background: 'linear-gradient(90deg,transparent,#d97706,transparent)', marginBottom: 28, borderRadius: 2 }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.6rem', color: '#d97706', letterSpacing: '0.18em', textAlign: 'center', marginBottom: 16 }}>
        {c.badge}
      </div>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(1.3rem,4vw,1.7rem)', color: '#fef3c7', fontWeight: 700, textAlign: 'center', lineHeight: 1.3, marginBottom: 28 }}>
        {c.heading}
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        {c.points.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '13px 15px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: 2 }}>{p.icon}</span>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: '#d97706', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 3 }}>
                {p.title}
              </div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '0.88rem', color: '#a89880', lineHeight: 1.6 }}>
                {p.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onDismiss}
        style={{ width: '100%', padding: '14px 24px', borderRadius: 30, background: 'linear-gradient(135deg,#d97706cc,#d9770688)', border: '1px solid #d97706', color: '#fff', fontFamily: 'var(--mono)', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', marginBottom: 12, transition: 'opacity 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        {c.cta}
      </button>

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--mono)', fontSize: '0.72rem', cursor: 'pointer', padding: '4px 8px' }}
          onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
        >
          {c.skip}
        </button>
      </div>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────
export default function WelcomeOverlay() {
  const { lang, setLang } = useLang();
  const [visible, setVisible]   = useState(false);
  const [leaving, setLeaving]   = useState(false);
  const [step,    setStep]      = useState('lang'); // 'lang' | 'welcome'

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setTimeout(() => setVisible(true), 400);
  }, []);

  if (!visible) return null;

  const handleLangPick = (picked) => {
    setLang(picked);
    setStep('welcome');
  };

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setLeaving(true);
    setTimeout(() => setVisible(false), 350);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,4,8,0.93)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', opacity: leaving ? 0 : 1, transition: 'opacity 0.35s ease' }}
    >
      <div
        style={{ width: '100%', maxWidth: 480, background: 'linear-gradient(160deg,#13100a,#0d0a12)', border: '1px solid rgba(217,119,6,0.35)', borderRadius: 28, padding: '32px 28px 24px', boxShadow: '0 0 80px rgba(0,0,0,0.9),0 0 40px rgba(217,119,6,0.08)', transform: leaving ? 'translateY(12px) scale(0.97)' : 'translateY(0) scale(1)', transition: 'transform 0.35s ease' }}
      >
        {step === 'lang'
          ? <LangStep onPick={handleLangPick} />
          : <WelcomeStep lang={lang} onDismiss={dismiss} />
        }
      </div>
    </div>
  );
}
