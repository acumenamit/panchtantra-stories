import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang, t } from '../LangContext';
import LangToggle from '../components/LangToggle';
import ShareButton from '../components/ShareButton';
import STORIES, { FEATURED_STORY_ID } from '../stories';
import { trackPageView, trackLanguageSwitched } from '../analytics';
import useHistory from '../components/useHistory';

const UI = {
  en: {
    heading: 'Ancient Wisdom,', heading2: 'Interactive Stories',
    sub: 'Stories from the Panchatantra — written 2,000 years ago to teach children the art of wise living through adventure and choice.',
    featured: '✦ FEATURED STORY',
    allStories: '✦ ALL STORIES',
    coming: 'MORE STORIES COMING SOON',
    newBadge: 'NEW',
    readNow: 'Read now →',
  },
  hi: {
    heading: 'प्राचीन ज्ञान,', heading2: 'संवादात्मक कहानियाँ',
    sub: 'पञ्चतन्त्र की कहानियाँ — २,००० साल पहले लिखी गईं, बच्चों को साहसिक चुनावों के ज़रिए बुद्धिमान जीवन की कला सिखाने के लिए।',
    featured: '✦ विशेष कहानी',
    allStories: '✦ सभी कहानियाँ',
    coming: 'और कहानियाँ जल्द आ रही हैं',
    newBadge: 'नया',
    readNow: 'पढ़ें →',
  },
};

// A story is "new" if added within the last 30 days
function isNew(story) {
  if (!story.addedOn) return false;
  const added = new Date(story.addedOn);
  const now   = new Date();
  const diffDays = (now - added) / (1000 * 60 * 60 * 24);
  return diffDays <= 7;
}

// Sort newest first
function sortedStories(stories) {
  return [...stories].sort((a, b) => {
    const da = a.addedOn ? new Date(a.addedOn) : new Date(0);
    const db = b.addedOn ? new Date(b.addedOn) : new Date(0);
    return db - da;
  });
}

// ── Featured hero card ────────────────────────────────────────
function FeaturedCard({ story, lang, onClick, status }) {
  const color = story.color;
  const ui    = UI[lang];
  return (
    <div style={{ width:'100%', maxWidth:960, marginBottom:48 }}>
      {/* Section label */}
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'#d97706', letterSpacing:'0.18em', marginBottom:16 }}>
        {ui.featured}
      </div>

      <button onClick={onClick}
        style={{ width:'100%', display:'flex', flexDirection:'column', textAlign:'left', borderRadius:24, background:`linear-gradient(135deg,${color}18,${color}08)`, border:`1px solid ${color}55`, cursor:'pointer', overflow:'hidden', position:'relative', transition:'all 0.3s ease' }}
        onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow=`0 20px 60px ${color}30`; e.currentTarget.style.border=`1px solid ${color}99`; }}
        onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; e.currentTarget.style.border=`1px solid ${color}55`; }}>

        {/* Top gradient line */}
        <div style={{ height:3, background:`linear-gradient(90deg,transparent,${color},transparent)`, width:'100%' }} />

        <div style={{ padding:'32px 36px', display:'flex', gap:32, alignItems:'center', flexWrap:'wrap' }}>
          {/* Left — emoji + badges */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, minWidth:80 }}>
            <div style={{ fontSize:'4rem' }}>{story.emoji}</div>
            {isNew(story) && (
              <span style={{ padding:'3px 10px', borderRadius:20, background:'#16a34a33', border:'1px solid #16a34a88', color:'#4ade80', fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em' }}>
                {ui.newBadge}
              </span>
            )}
            {status === 'completed' && !isNew(story) && (
              <span style={{ padding:'3px 10px', borderRadius:20, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', color:'#4ade80', fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700 }}>
                ✓ {lang === 'hi' ? 'पढ़ी' : 'Read'}
              </span>
            )}
            {status === 'in_progress' && !isNew(story) && (
              <span style={{ padding:'3px 10px', borderRadius:20, background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.4)', color:'#fbbf24', fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700 }}>
                {lang === 'hi' ? '… पढ़ रहे हैं' : '… Reading'}
              </span>
            )}
          </div>

          {/* Right — content */}
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:'0.62rem', color, letterSpacing:'0.15em', marginBottom:8 }}>
              {t(story.book, lang)}
            </div>
            <h2 style={{ fontFamily:'var(--serif)', fontSize:'clamp(1.4rem,3vw,2rem)', color:'#fef3c7', fontWeight:700, lineHeight:1.2, marginBottom:12 }}>
              {t(story.title, lang)}
            </h2>
            <p style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#c4b090', lineHeight:1.7, marginBottom:20, maxWidth:520 }}>
              {t(story.description, lang)}
            </p>

            {/* Meta row */}
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ padding:'4px 12px', borderRadius:20, background:`${color}22`, border:`1px solid ${color}44`, color, fontFamily:'var(--mono)', fontSize:'0.65rem' }}>
                {lang === 'hi' ? 'आयु' : 'Age'} {story.age}
              </span>
              <span style={{ padding:'4px 12px', borderRadius:20, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.5)', fontFamily:'var(--mono)', fontSize:'0.65rem' }}>
                ⏱ {t(story.duration, lang)}
              </span>
              <span style={{ marginLeft:'auto', padding:'4px 16px', borderRadius:20, background:`${color}33`, border:`1px solid ${color}66`, color, fontFamily:'var(--mono)', fontSize:'0.7rem', fontWeight:700 }}>
                {ui.readNow}
              </span>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

// ── Regular story card ────────────────────────────────────────
function StoryCard({ story, lang, onClick, status }) {
  const color   = story.color;
  const ui      = UI[lang];
  const _isNew  = isNew(story);

  return (
    <button onClick={onClick}
      style={{ display:'flex', flexDirection:'column', textAlign:'left', padding:'24px', borderRadius:20, background: status==='completed' ? `${color}08` : 'rgba(255,255,255,0.03)', border:`1px solid ${status==='completed' ? color+'55' : color+'33'}`, cursor:'pointer', transition:'all 0.25s ease', position:'relative', overflow:'hidden' }}
      onMouseEnter={e => { e.currentTarget.style.background=`${color}0f`; e.currentTarget.style.border=`1px solid ${color}77`; e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow=`0 12px 40px ${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.03)'; e.currentTarget.style.border=`1px solid ${color}33`; e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; }}>

      {/* Top shimmer */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${color},transparent)` }} />

      {/* Status badge — top right corner */}
      {status === 'completed' && !_isNew && (
        <div style={{ position:'absolute', top:14, right:14, padding:'2px 8px', borderRadius:20, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', color:'#4ade80', fontFamily:'var(--mono)', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.08em' }}>
          ✓
        </div>
      )}
      {status === 'in_progress' && !_isNew && (
        <div style={{ position:'absolute', top:14, right:14, padding:'2px 8px', borderRadius:20, background:`rgba(251,191,36,0.12)`, border:`1px solid rgba(251,191,36,0.4)`, color:'#fbbf24', fontFamily:'var(--mono)', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.08em' }}>
          …
        </div>
      )}
      {/* NEW badge — top right, takes priority over status */}
      {_isNew && (
        <div style={{ position:'absolute', top:14, right:14, padding:'2px 8px', borderRadius:20, background:'#16a34a33', border:'1px solid #16a34a88', color:'#4ade80', fontFamily:'var(--mono)', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.1em' }}>
          {ui.newBadge}
        </div>
      )}

      <div style={{ fontSize:'2.2rem', marginBottom:12 }}>{story.emoji}</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.6rem', color, letterSpacing:'0.15em', marginBottom:6 }}>{t(story.book, lang)}</div>
      <h2 style={{ fontFamily:'var(--serif)', fontSize:'1.15rem', color:'#fef3c7', fontWeight:700, marginBottom:8, lineHeight:1.3 }}>{t(story.title, lang)}</h2>
      <p style={{ fontFamily:'var(--serif)', fontSize:'0.9rem', color:'#a89880', lineHeight:1.6, marginBottom:16, flex:1 }}>{t(story.description, lang)}</p>

      {/* Age + duration tags */}
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

// ── Coming soon placeholder ───────────────────────────────────
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

// ── Main Home page ────────────────────────────────────────────
export default function Home() {
  const navigate      = useNavigate();
  const { lang }      = useLang();
  const ui            = UI[lang];
  const { getStoryStatus, getAllHistory } = useHistory();
  // eslint-disable-next-line
  const _history      = getAllHistory(); // read once to trigger re-render awareness

  // Sort newest first, separate featured from grid
  const sorted        = sortedStories(STORIES);
  const featured      = sorted.find(s => s.id === FEATURED_STORY_ID) || sorted[0];
  const gridStories   = sorted.filter(s => s.id !== featured.id);
  const remainder     = gridStories.length % 3;
  const placeholders  = remainder === 0 ? 0 : 3 - remainder;

  const prevLang = lang;

  useEffect(() => {
    trackPageView('home', { lang });
  }, []); // eslint-disable-line

  const handleLangChange = (newLang) => {
    if (newLang !== prevLang) trackLanguageSwitched(prevLang, newLang, 'home');
  };

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#0d0a05,#080608)', display:'flex', flexDirection:'column', alignItems:'center', padding:'48px 16px 64px' }}>

      {/* ── Hero header ── */}
      <div style={{ textAlign:'center', marginBottom:48, maxWidth:580 }}>
        <div style={{ fontSize:'3rem', marginBottom:16 }}>📚</div>
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
        <ShareButton lang={lang} accent="#d97706" variant="default" />
      </div>

      {/* ── Featured story ── */}
      <FeaturedCard
        story={featured}
        lang={lang}
        status={getStoryStatus(featured.id)}
        onClick={() => navigate(`/story/${featured.id}`)}
      />

      {/* ── All stories grid ── */}
      <div style={{ width:'100%', maxWidth:960 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.3)', letterSpacing:'0.18em', marginBottom:20 }}>
          {ui.allStories}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:20 }}>
          {gridStories.map(story => (
            <StoryCard
              key={story.id}
              story={story}
              lang={lang}
              status={getStoryStatus(story.id)}
              onClick={() => navigate(`/story/${story.id}`)}
            />
          ))}
          {Array.from({ length: placeholders }).map((_, i) => (
            <ComingSoonCard key={i} lang={lang} />
          ))}
        </div>
      </div>

      <div style={{ marginTop:64, fontFamily:'var(--mono)', fontSize:'0.62rem', color:'rgba(255,255,255,0.12)', letterSpacing:'0.18em', textAlign:'center' }}>
        {lang === 'hi'
          ? '✦ पञ्चतन्त्र ✦ नीतिशास्त्र ✦ सभी उम्र के लिए ज्ञान ✦'
          : '✦ PANCHATANTRA ✦ NITISHASTRA ✦ WISDOM FOR ALL AGES ✦'}
      </div>
    </div>
  );
}
