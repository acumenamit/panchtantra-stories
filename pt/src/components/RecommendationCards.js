import { t } from '../LangContext';
import useHistory from './useHistory';
import STORIES from '../stories';

// ── Recommendation logic ──────────────────────────────────────
// Picks 2 stories the user hasn't completed, preferring same age group
function getRecommendations(currentStoryId, completedIds, count = 2) {
  const current = STORIES.find(s => s.id === currentStoryId);
  const others  = STORIES.filter(s => s.id !== currentStoryId);

  const scored = others.map(s => {
    let pts = 0;
    if (!completedIds.includes(s.id)) pts += 2; // not yet read
    if (current && s.age === current.age) pts += 1; // same age group
    return { ...s, _score: pts };
  });

  return scored
    .sort((a, b) => b._score - a._score)
    .slice(0, count);
}

// ── Single recommendation card ────────────────────────────────
function RecoCard({ story, lang, accent, onNavigate }) {
  const color = story.color;

  return (
    <button
      onClick={() => onNavigate(story.id)}
      style={{
        flex: 1,
        minWidth: 130,
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
        padding: '16px',
        borderRadius: 16,
        background: `${color}0a`,
        border: `1px solid ${color}33`,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `${color}18`;
        e.currentTarget.style.borderColor = `${color}66`;
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = `${color}0a`;
        e.currentTarget.style.borderColor = `${color}33`;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Top shimmer */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${color},transparent)` }} />

      {/* Story image if available */}
      {story.nodes?.start?.image && (
        <div style={{ width: '100%', height: 80, borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
          <img
            src={story.nodes.start.image}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
          />
        </div>
      )}

      <div style={{ fontSize: '1.4rem', marginBottom: 6 }}>{story.emoji}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem', color, letterSpacing: '0.1em', marginBottom: 4 }}>
        {lang === 'hi' ? 'आयु' : 'Age'} {story.age}
      </div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '0.88rem', color: '#fef3c7', fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>
        {t(story.title, lang)}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color, marginTop: 'auto', paddingTop: 8 }}>
        {lang === 'hi' ? 'पढ़ें →' : 'Read →'}
      </div>
    </button>
  );
}

// ── Main export ───────────────────────────────────────────────
export default function RecommendationCards({ currentStoryId, lang, accent, onNavigate }) {
  const { getAllHistory } = useHistory();
  const history    = getAllHistory();
  const completed  = Object.entries(history)
    .filter(([, v]) => v.status === 'completed')
    .map(([k]) => k);

  const recs = getRecommendations(currentStoryId, completed);

  if (!recs.length) return null;

  const label = lang === 'hi' ? '✦ आगे पढ़ें' : '✦ READ NEXT';

  return (
    <div style={{ marginTop: 28 }}>
      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 16 }} />

      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em', marginBottom: 14 }}>
        {label}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {recs.map(story => (
          <RecoCard
            key={story.id}
            story={story}
            lang={lang}
            accent={accent}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}
