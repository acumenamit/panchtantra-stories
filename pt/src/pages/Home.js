import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang, t } from '../LangContext';
import LangToggle from '../components/LangToggle';
import ShareButton from '../components/ShareButton';
import STORIES, { FEATURED_STORY_ID } from '../stories';
import { trackPageView, trackLanguageSwitched } from '../analytics';
import useHistory from '../components/useHistory';
import WelcomeOverlay from '../components/WelcomeOverlay';
import useInstallPrompt from '../components/useInstallPrompt';

const UI = {
  en: {
    heading: 'Ancient Wisdom,', heading2: 'Interactive Stories',
    sub: 'Stories from the Panchatantra — written 2,000 years ago to teach children the art of wise living through adventure and choice.',
    featured: '✦ FEATURED STORY',
    allStories: '✦ ALL STORIES',
    coming: 'MORE STORIES COMING SOON',
    newBadge: 'NEW',
    readNow: 'Read now →',
    filterAll: 'All',
    filterAge: 'Age',
  },
  hi: {
    heading: 'प्राचीन ज्ञान,', heading2: 'संवादात्मक कहानियाँ',
    sub: 'पञ्चतन्त्र की कहानियाँ — २,००० साल पहले लिखी गईं, बच्चों को साहसिक चुनावों के ज़रिए बुद्धिमान जीवन की कला सिखाने के लिए।',
    featured: '✦ विशेष कहानी',
    allStories: '✦ सभी कहानियाँ',
    coming: 'और कहानियाँ जल्द आ रही हैं',
    newBadge: 'नया',
    readNow: 'पढ़ें →',
    filterAll: 'सभी',
    filterAge: 'आयु',
  },
  ar: {
    heading: 'حكمة قديمة،', heading2: 'قصص تفاعلية',
    sub: 'حكايات شعبية — تعلّم الأطفال فن الحياة الحكيمة من خلال المغامرة والاختيار.',
    featured: '✦ القصة المميزة',
    allStories: '✦ جميع القصص',
    coming: 'قصص جديدة قادمة قريباً',
    newBadge: 'جديد',
    readNow: 'اقرأ الآن ←',
    filterAll: 'الكل',
    filterAge: 'العمر',
  },
};

function isNew(story) {
  if (!story.addedOn) return false;
  const added = new Date(story.addedOn);
  const now   = new Date();
  const diffDays = (now - added) / (1000 * 60 * 60 * 24);
  return diffDays <= 7;
}

function sortedStories(stories) {
  return [...stories].sort((a, b) => {
    const da = a.addedOn ? new Date(a.addedOn) : new Date(0);
    const db = b.addedOn ? new Date(b.addedOn) : new Date(0);
    return db - da;
  });
}

function FeaturedCard({ story, lang, onClick, status }) {
  const color = story.color;
  const ui = UI[lang] || UI.en;
  return (
    <div style={{ width:'100%', maxWidth:960, marginBottom:48 }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'#c8922a', letterSpacing:'0.18em', marginBottom:16 }}>
        {ui.featured}
      </div>
      <button onClick={onClick}
        style={{ width:'100%', display:'flex', flexDirection:'column', textAlign:'left', borderRadius:24, background:`linear-gradient(135deg,${color}18,${color}08)`, border:`1px solid ${color}55`, cursor:'pointer', overflow:'hidden', position:'relative', transition:'all 0.3s ease' }}
        onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow=`0 20px 60px ${color}30`; e.currentTarget.style.border=`1px solid ${color}99`; }}
        onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; e.currentTarget.style.border=`1px solid ${color}55`; }}>
        <div style={{ height:3, background:`linear-gradient(90deg,transparent,${color},transparent)`, width:'100%' }} />
        <div style={{ padding:'32px 36px', display:'flex', gap:32, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, minWidth:80 }}>
            <div style={{ fontSize:'4rem' }}>{story.emoji}</div>
            {isNew(story) && status === 'not_started' && (
              <span style={{ padding:'3px 10px', borderRadius:20, background:'#16a34a33', border:'1px solid #16a34a88', color:'#4ade80', fontFamily:"'Noto Naskh Arabic','Space Mono',monospace", fontSize:'0.62rem', fontWeight:700, letterSpacing:0 }}>{ui.newBadge}</span>
            )}
            {status === 'completed' && (
              <span style={{ padding:'3px 10px', borderRadius:20, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', color:'#4ade80', fontFamily:"'Noto Naskh Arabic','Space Mono',monospace", fontSize:'0.62rem', fontWeight:700, letterSpacing:0 }}>
                ✓ {lang === 'ar' ? 'قُرئت' : 'Read'}
              </span>
            )}
            {status === 'in_progress' && (
              <span style={{ padding:'3px 10px', borderRadius:20, background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.4)', color:'#fbbf24', fontFamily:"'Noto Naskh Arabic','Space Mono',monospace", fontSize:'0.62rem', fontWeight:700, letterSpacing:0 }}>
                {lang === 'ar' ? '… جارٍ القراءة' : '… Reading'}
              </span>
            )}
          </div>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:'0.62rem', color, letterSpacing:'0.15em', marginBottom:8 }}>{t(story.book, lang)}</div>
            <h2 style={{ fontFamily:'var(--serif)', fontSize:'clamp(1.4rem,3vw,2rem)', color:'#fef3c7', fontWeight:700, lineHeight:1.2, marginBottom:12 }}>{t(story.title, lang)}</h2>
            <p style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#c4b090', lineHeight:1.7, marginBottom:20, maxWidth:520 }}>{t(story.description, lang)}</p>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ padding:'4px 12px', borderRadius:20, background:`${color}22`, border:`1px solid ${color}44`, color, fontFamily:'var(--mono)', fontSize:'0.65rem' }}>
                {lang === 'ar' ? 'العمر' : 'Age'} {story.age}
              </span>
              <span style={{ padding:'4px 12px', borderRadius:20, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.5)', fontFamily:'var(--mono)', fontSize:'0.65rem' }}>
                ⏱ {t(story.duration, lang)}
              </span>
              <span style={{ marginLeft:'auto', padding:'4px 16px', borderRadius:20, background:`${color}33`, border:`1px solid ${color}66`, color, fontFamily:'var(--mono)', fontSize:'0.7rem', fontWeight:700 }}>{ui.readNow}</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

function StoryCard({ story, lang, onClick, status }) {
  const color  = story.color;
  const ui = UI[lang] || UI.en;
  const _isNew = isNew(story);
  return (
    <button onClick={onClick}
      style={{ display:'flex', flexDirection:'column', textAlign:'left', padding:'24px', borderRadius:20, background: status==='completed' ? `${color}08` : 'rgba(255,255,255,0.03)', border:`1px solid ${status==='completed' ? color+'55' : color+'33'}`, cursor:'pointer', transition:'all 0.25s ease', position:'relative', overflow:'hidden' }}
      onMouseEnter={e => { e.currentTarget.style.background=`${color}0f`; e.currentTarget.style.border=`1px solid ${color}77`; e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow=`0 12px 40px ${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.03)'; e.currentTarget.style.border=`1px solid ${color}33`; e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${color},transparent)` }} />
      {status === 'completed' && (
        <div style={{ position:'absolute', top:14, ...(lang === 'ar' ? { left:14 } : { right:14 }), padding:'2px 8px', borderRadius:20, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', color:'#4ade80', fontFamily:"'Noto Naskh Arabic','Space Mono',monospace", fontSize:'0.58rem', fontWeight:700, letterSpacing:0 }}>✓</div>
      )}
      {status === 'in_progress' && (
        <div style={{ position:'absolute', top:14, ...(lang === 'ar' ? { left:14 } : { right:14 }), padding:'2px 8px', borderRadius:20, background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.4)', color:'#fbbf24', fontFamily:"'Noto Naskh Arabic','Space Mono',monospace", fontSize:'0.58rem', fontWeight:700, letterSpacing:0 }}>{lang === 'ar' ? '…يُقرأ' : '…Reading'}</div>
      )}
      {_isNew && status === 'not_started' && (
        <div style={{ position:'absolute', top:14, ...(lang === 'ar' ? { left:14 } : { right:14 }), padding:'2px 8px', borderRadius:20, background:'#16a34a33', border:'1px solid #16a34a88', color:'#4ade80', fontFamily:"'Noto Naskh Arabic','Space Mono',monospace", fontSize:'0.58rem', fontWeight:700, letterSpacing:0 }}>{ui.newBadge}</div>
      )}
      <div style={{ fontSize:'2.2rem', marginBottom:12 }}>{story.emoji}</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.6rem', color, letterSpacing:'0.15em', marginBottom:6 }}>{t(story.book, lang)}</div>
      <h2 style={{ fontFamily:'var(--serif)', fontSize:'1.15rem', color:'#fef3c7', fontWeight:700, marginBottom:8, lineHeight:1.3 }}>{t(story.title, lang)}</h2>
      <p style={{ fontFamily:'var(--serif)', fontSize:'0.9rem', color:'#a89880', lineHeight:1.6, marginBottom:16, flex:1 }}>{t(story.description, lang)}</p>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <span style={{ padding:'3px 10px', borderRadius:20, background:`${color}18`, border:`1px solid ${color}33`, color, fontFamily:'var(--mono)', fontSize:'0.62rem' }}>
          {lang === 'ar' ? 'العمر' : 'Age'} {story.age}
        </span>
        <span style={{ padding:'3px 10px', borderRadius:20, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.4)', fontFamily:'var(--mono)', fontSize:'0.62rem' }}>
          ⏱ {t(story.duration, lang)}
        </span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding:'24px', borderRadius:20, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', overflow:'hidden' }}>
      <div className="skeleton" style={{ width:40, height:40, borderRadius:10, marginBottom:14 }} />
      <div className="skeleton" style={{ width:'55%', height:10, marginBottom:10 }} />
      <div className="skeleton" style={{ width:'85%', height:16, marginBottom:8 }} />
      <div className="skeleton" style={{ width:'70%', height:16, marginBottom:20 }} />
      <div className="skeleton" style={{ width:'90%', height:12, marginBottom:8 }} />
      <div className="skeleton" style={{ width:'80%', height:12, marginBottom:20 }} />
      <div style={{ display:'flex', gap:8 }}>
        <div className="skeleton" style={{ width:60, height:22, borderRadius:20 }} />
        <div className="skeleton" style={{ width:80, height:22, borderRadius:20 }} />
      </div>
    </div>
  );
}

function SkeletonFeatured() {
  return (
    <div style={{ width:'100%', maxWidth:960, marginBottom:48 }}>
      <div className="skeleton" style={{ width:140, height:10, marginBottom:16, borderRadius:4 }} />
      <div style={{ width:'100%', borderRadius:24, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', padding:'32px 36px', display:'flex', gap:32, alignItems:'center' }}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
          <div className="skeleton" style={{ width:64, height:64, borderRadius:14 }} />
          <div className="skeleton" style={{ width:44, height:18, borderRadius:20 }} />
        </div>
        <div style={{ flex:1 }}>
          <div className="skeleton" style={{ width:'40%', height:10, marginBottom:12 }} />
          <div className="skeleton" style={{ width:'75%', height:28, marginBottom:14 }} />
          <div className="skeleton" style={{ width:'90%', height:14, marginBottom:8 }} />
          <div className="skeleton" style={{ width:'70%', height:14, marginBottom:24 }} />
          <div style={{ display:'flex', gap:10 }}>
            <div className="skeleton" style={{ width:70, height:26, borderRadius:20 }} />
            <div className="skeleton" style={{ width:90, height:26, borderRadius:20 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ComingSoonCard({ lang }) {
  return (
    <div style={{ padding:'24px', borderRadius:20, background:'rgba(255,255,255,0.01)', border:'1px dashed rgba(255,255,255,0.1)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:220, gap:12 }}>
      <div style={{ fontSize:'1.5rem', opacity:0.3 }}>📖</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.2)', letterSpacing:'0.1em', textAlign:'center' }}>
        {(UI[lang] || UI.en).coming}
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const ui = UI[lang] || UI.en;
  const { getStoryStatus, getAllHistory } = useHistory();
  // eslint-disable-next-line
  const _history = getAllHistory();
  const { canShowFooter, platform, isInstalled, triggerInstall, dismissFooter, hasDeferredPrompt } = useInstallPrompt();

  const [loading,      setLoading]      = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showIOSHint,  setShowIOSHint]  = useState(false);

  const sorted      = sortedStories(STORIES);
  const featured    = sorted.find(s => s.id === FEATURED_STORY_ID) || sorted[0];
  const allGrid     = sorted.filter(s => s.id !== featured.id);
  const gridStories = activeFilter === 'all' ? allGrid : allGrid.filter(s => s.age === activeFilter);
  const remainder   = gridStories.length % 3;
  const placeholders = remainder === 0 ? 0 : 3 - remainder;
  const ageGroups   = [...new Set(sorted.map(s => s.age))].sort();

  const prevLang = lang;

  useEffect(() => {
    trackPageView('home', { lang });
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line

  const handleLangChange = (newLang) => {
    if (newLang !== prevLang) trackLanguageSwitched(prevLang, newLang, 'home');
  };

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#09090f,#06060c)', display:'flex', flexDirection:'column', alignItems:'center', padding:'48px 16px 64px' }}>

      {/* ── Hero header ── */}
      <div style={{ textAlign:'center', marginBottom:48, maxWidth:580 }}>
        <div style={{ fontSize:'3rem', marginBottom:16 }}>🌙</div>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:24 }}>
          <LangToggle accent="#c8922a" onChange={handleLangChange} />
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.7rem', color:'#c8922a', letterSpacing:'0.22em', marginBottom:12 }}>
          {lang === 'ar' ? '✦ حكايات ✦' : '✦ HIKAYAT ✦'}
        </div>
        <h1 style={{ fontFamily:'var(--serif)', fontSize:'clamp(1.8rem,5vw,2.8rem)', color:'#fef3c7', fontWeight:700, lineHeight:1.25, marginBottom:16, textShadow:'0 2px 30px rgba(251,191,36,0.2)' }}>
          {ui.heading}<br />{ui.heading2}
        </h1>
        <p style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#8a7a5a', lineHeight:1.75, marginBottom:28 }}>
          {ui.sub}
        </p>
        <ShareButton lang={lang} accent="#c8922a" variant="default" />
      </div>

      {/* ── Featured story ── */}
      {loading
        ? <SkeletonFeatured />
        : <FeaturedCard story={featured} lang={lang} status={getStoryStatus(featured.id)} onClick={() => navigate(`/story/${featured.id}`)} />
      }

      {/* ── Filter bar ── */}
      <div style={{ width:'100%', maxWidth:960, marginBottom:28 }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <button onClick={() => setActiveFilter('all')}
            style={{ padding:'7px 18px', borderRadius:20, fontFamily:'var(--mono)', fontSize:'0.7rem', fontWeight: activeFilter==='all'?700:400, background: activeFilter==='all'?'#c8922a':'rgba(255,255,255,0.04)', border: activeFilter==='all'?'1px solid #c8922a':'1px solid rgba(255,255,255,0.12)', color: activeFilter==='all'?'#fff':'rgba(255,255,255,0.5)', cursor:'pointer', transition:'all 0.2s' }}
            onMouseEnter={e => { if(activeFilter!=='all'){e.currentTarget.style.borderColor='#c8922a';e.currentTarget.style.color='#c8922a';}}}
            onMouseLeave={e => { if(activeFilter!=='all'){e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';e.currentTarget.style.color='rgba(255,255,255,0.5)';}}}
          >{ui.filterAll}</button>
          {ageGroups.map(age => (
            <button key={age} onClick={() => setActiveFilter(age)}
              style={{ padding:'7px 18px', borderRadius:20, fontFamily:'var(--mono)', fontSize:'0.7rem', fontWeight: activeFilter===age?700:400, background: activeFilter===age?'#c8922a':'rgba(255,255,255,0.04)', border: activeFilter===age?'1px solid #c8922a':'1px solid rgba(255,255,255,0.12)', color: activeFilter===age?'#fff':'rgba(255,255,255,0.5)', cursor:'pointer', transition:'all 0.2s' }}
              onMouseEnter={e => { if(activeFilter!==age){e.currentTarget.style.borderColor='#c8922a';e.currentTarget.style.color='#c8922a';}}}
              onMouseLeave={e => { if(activeFilter!==age){e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';e.currentTarget.style.color='rgba(255,255,255,0.5)';}}}
            >{ui.filterAge} {age}</button>
          ))}
          <span style={{ marginLeft:'auto', fontFamily:'var(--mono)', fontSize:'0.62rem', color:'rgba(255,255,255,0.25)' }}>
            {gridStories.length} {lang==='ar'?'قصص':gridStories.length===1?'story':'stories'}
          </span>
        </div>
      </div>

      {/* ── All stories grid ── */}
      <div style={{ width:'100%', maxWidth:960 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.3)', letterSpacing:'0.18em', marginBottom:20 }}>
          {ui.allStories}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:20 }}>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
                {gridStories.map(story => (
                  <StoryCard key={story.id} story={story} lang={lang} status={getStoryStatus(story.id)} onClick={() => navigate(`/story/${story.id}`)} />
                ))}
                {Array.from({ length: placeholders }).map((_, i) => <ComingSoonCard key={i} lang={lang} />)}
              </>
          }
        </div>
      </div>

      {/* ── Footer with persistent install option ── */}
      <div style={{ marginTop:64, textAlign:'center' }}>

        {/* Install button — only shown if not already installed */}
        {!isInstalled && canShowFooter && platform === 'chromium' && (
          <div style={{ marginBottom:24 }}>
            <button onClick={hasDeferredPrompt ? triggerInstall : undefined}
              style={{ background:'none', border:'1px solid rgba(217,119,6,0.3)', borderRadius:20, padding:'7px 18px', fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(217,119,6,0.7)', cursor:'pointer', letterSpacing:'0.08em', transition:'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#c8922a'; e.currentTarget.style.color='#c8922a'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(217,119,6,0.3)'; e.currentTarget.style.color='rgba(217,119,6,0.7)'; }}
            >
              📲 {lang==='ar' ? 'تثبيت التطبيق' : 'Install App'}
            </button>
            <button onClick={dismissFooter} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.2)', fontFamily:'var(--mono)', fontSize:'0.65rem', cursor:'pointer', marginLeft:8 }} title="Hide">✕</button>
          </div>
        )}

        {/* iOS — show instructions on tap */}
        {!isInstalled && canShowFooter && platform !== 'chromium' && platform !== 'unknown' && (
          <div style={{ marginBottom:24 }}>
            <button onClick={() => setShowIOSHint(h => !h)}
              style={{ background:'none', border:'1px solid rgba(217,119,6,0.3)', borderRadius:20, padding:'7px 18px', fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(217,119,6,0.7)', cursor:'pointer', letterSpacing:'0.08em', transition:'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#c8922a'; e.currentTarget.style.color='#c8922a'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(217,119,6,0.3)'; e.currentTarget.style.color='rgba(217,119,6,0.7)'; }}
            >
              📲 {platform === 'mac-safari-17' ? (lang==='ar' ? 'أضف إلى Dock' : 'Add to Dock') : platform === 'ios-other' ? (lang==='ar' ? 'افتح في Safari' : 'Open in Safari') : (lang==='ar' ? 'أضف إلى الشاشة الرئيسية' : 'Add to Home Screen')}
            </button>
            <button onClick={dismissFooter} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.2)', fontFamily:'var(--mono)', fontSize:'0.65rem', cursor:'pointer', marginLeft:8 }} title="Hide">✕</button>
            {showIOSHint && (
              <div style={{ marginTop:12, padding:'14px 16px', borderRadius:14, background:'rgba(217,119,6,0.08)', border:'1px solid rgba(217,119,6,0.25)', maxWidth:340, margin:'12px auto 0', textAlign:'left' }}>
                <div style={{ fontFamily:'var(--serif)', fontSize:'0.82rem', color:'#c4b090', lineHeight:1.9 }}>
                  {lang==='ar' ? (
                    <><div>١. اضغط زر المشاركة في Safari ↑</div><div>٢. اضغط &quot;Add to Home Screen&quot;</div><div>٣. اضغط Add</div></>
                  ) : (
                    <><div>1. Tap the Share button in Safari ↑</div><div>2. Tap &quot;Add to Home Screen&quot;</div><div>3. Tap Add</div></>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ fontFamily:'var(--mono)', fontSize:'0.62rem', color:'rgba(255,255,255,0.12)', letterSpacing:'0.18em' }}>
          {lang==='ar'
            ? '✦ حكايات ✦ قصص تفاعلية ✦ حكمة لكل الأعمار ✦'
            : '✦ HIKAYAT ✦ INTERACTIVE TALES ✦ WISDOM FOR ALL AGES ✦'}
        </div>
      </div>

      {/* First-visit onboarding overlay */}
      <WelcomeOverlay />
    </div>
  );
}
