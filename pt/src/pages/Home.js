import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang, t } from '../LangContext';
import LangToggle from '../components/LangToggle';
import ShareButton from '../components/ShareButton';
import STORIES from '../stories';
import { trackPageView, trackLanguageSwitched } from '../analytics';

const UI = {
  en: {
    heading: 'Ancient Wisdom,', heading2: 'Interactive Stories',
    sub: 'Stories from the Panchatantra — written 2,000 years ago to teach children the art of wise living through adventure and choice.',
    coming: 'MORE STORIES COMING SOON',
  },
  hi: {
    heading: 'प्राचीन ज्ञान,', heading2: 'संवादात्मक कहानियाँ',
    sub: 'पञ्चतन्त्र की कहानियाँ — २,००० साल पहले लिखी गईं, बच्चों को साहसिक चुनावों के ज़रिए बुद्धिमान जीवन की कला सिखाने के लिए।',
    coming: 'और कहानियाँ जल्द आ रही हैं',
  },
};

function StoryCard({ story, lang, onClick }) {
  const color = story.color;
  return (
    <button onClick={onClick}
      style={{ display:'flex', flexDirection:'column', textAlign:'left', padding:'24px', borderRadius:20, background:'rgba(255,255,255,0.03)', border:`1px solid ${color}33`, cursor:'pointer', transition:'all 0.25s ease', position:'relative', overflow:'hidden' }}
      onMouseEnter={e => { e.currentTarget.style.background=`${color}0f`; e.currentTarget.style.border=`1px solid ${color}77`; e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow=`0 12px 40px ${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.03)'; e.currentTarget.style.border=`1px solid ${color}33`; e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${color},transparent)` }} />
      <div style={{ fontSize:'2.2rem', marginBottom:12 }}>{story.emoji}</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.6rem', color, letterSpacing:'0.15em', marginBottom:6 }}>{t(story.book, lang)}</div>
      <h2 style={{ fontFamily:'var(--serif)', fontSize:'1.15rem', color:'#fef3c7', fontWeight:700, marginBottom:8, lineHeight:1.3 }}>{t(story.title, lang)}</h2>
      <p style={{ fontFamily:'var(--serif)', fontSize:'0.9rem', color:'#a89880', lineHeight:1.6, marginBottom:16, flex:1 }}>{t(story.description, lang)}</p>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <span style={{ padding:'3px 10px', borderRadius:20, background:`${color}18`, border:`1px solid ${color}33`, color, fontFamily:'var(--mono)', fontSize:'0.62rem' }}>
          {lang === 'hi' ? 'आयु' : 'Age'} {story.age}
        </span>
        <span style={{ padding:'3px 10px', borderRadius:20, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.4)', fontFamily:'var(--mono)', fontSize:'0.62rem' }}>
          ⏱ {t(story.duration, lang)}
        </span>
      </div>
    </button>
  );
}

function ComingSoonCard({ lang }) {
  return (
    <div style={{ padding:'24px', borderRadius:20, background:'rgba(255,255,255,0.01)', border:'1px dashed rgba(255,255,255,0.1)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:220, gap:12 }}>
      <div style={{ fontSize:'1.5rem', opacity:0.3 }}>📖</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.2)', letterSpacing:'0.1em', textAlign:'center' }}>
        {UI[lang].coming}
      </div>
    </div>
  );
}

export default function Home() {
  const navigate  = useNavigate();
  const { lang, setLang } = useLang();
  const ui        = UI[lang];
  const remainder = STORIES.length % 3;
  const placeholders = remainder === 0 ? 0 : 3 - remainder;

  // Track page view on mount
  useEffect(() => {
    trackPageView('home', { lang });
  }, []); // eslint-disable-line

  // Track language switches
  const prevLang = lang;
  const handleLangChange = (newLang) => {
    if (newLang !== prevLang) {
      trackLanguageSwitched(prevLang, newLang, 'home');
    }
  };

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#0d0a05,#080608)', display:'flex', flexDirection:'column', alignItems:'center', padding:'48px 16px 64px' }}>

      {/* Hero */}
      <div style={{ textAlign:'center', marginBottom:52, maxWidth:580 }}>
        <div style={{ fontSize:'3rem', marginBottom:16 }}>📚</div>

        {/* Lang toggle */}
        <div style={{ display:'flex', justifyContent:'center', marginBottom:24 }}>
          <LangToggle accent="#d97706" onChange={handleLangChange} />
        </div>

        <div style={{ fontFamily:'var(--mono)', fontSize:'0.7rem', color:'#d97706', letterSpacing:'0.22em', marginBottom:12 }}>
          {lang === 'hi' ? '✦ पञ्चतन्त्र ✦' : '✦ PANCHATANTRA ✦'}
        </div>
        <h1 style={{ fontFamily:'var(--serif)', fontSize:'clamp(1.8rem,5vw,2.8rem)', color:'#fef3c7', fontWeight:700, lineHeight:1.25, marginBottom:16, textShadow:'0 2px 30px rgba(251,191,36,0.2)' }}>
          {ui.heading}<br />{ui.heading2}
        </h1>
        <p style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#8a7a5a', lineHeight:1.75, marginBottom:28 }}>
          {ui.sub}
        </p>

        {/* Share button on home screen */}
        <ShareButton lang={lang} accent="#d97706" variant="default" />
      </div>

      {/* Story grid */}
      <div style={{ width:'100%', maxWidth:960, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:20 }}>
        {STORIES.map(story => (
          <StoryCard
            key={story.id}
            story={story}
            lang={lang}
            onClick={() => {
              navigate(`/story/${story.id}`);
            }}
          />
        ))}
        {Array.from({ length: placeholders }).map((_, i) => <ComingSoonCard key={i} lang={lang} />)}
      </div>

      <div style={{ marginTop:64, fontFamily:'var(--mono)', fontSize:'0.62rem', color:'rgba(255,255,255,0.12)', letterSpacing:'0.18em', textAlign:'center' }}>
        {lang === 'hi'
          ? '✦ पञ्चतन्त्र ✦ नीतिशास्त्र ✦ सभी उम्र के लिए ज्ञान ✦'
          : '✦ PANCHATANTRA ✦ NITISHASTRA ✦ WISDOM FOR ALL AGES ✦'}
      </div>
    </div>
  );
}
