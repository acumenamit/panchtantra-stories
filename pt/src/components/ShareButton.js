import { useState } from 'react';
import { t } from '../LangContext';

export default function ShareButton({ story, lang, accent, variant = 'default' }) {
  const [state, setState] = useState('idle'); // idle | copied | error

  // What we share
  const getShareData = () => {
    if (story) {
      const title = t(story.title, lang);
      const desc  = t(story.description, lang);
      return {
        title: lang === 'hi'
          ? `पञ्चतन्त्र — ${title}`
          : `Panchatantra — ${title}`,
        text: lang === 'hi'
          ? `${desc}\n\nनीतिशास्त्र की इंटरैक्टिव कहानियाँ 🌿`
          : `${desc}\n\nInteractive stories with ancient wisdom 🌿`,
        url: window.location.href,
      };
    }
    // Home screen share
    return {
      title: lang === 'hi' ? 'पञ्चतन्त्र — बच्चों के लिए कहानियाँ' : 'Panchatantra — Interactive Stories for Kids',
      text:  lang === 'hi'
        ? 'पञ्चतन्त्र की इंटरैक्टिव कहानियाँ — हिन्दी और अंग्रेज़ी में। बच्चों के लिए प्राचीन ज्ञान 🌿'
        : 'Interactive Panchatantra stories in English & Hindi — ancient wisdom for children 🌿',
      url: window.location.origin,
    };
  };

  const handleShare = async () => {
    const data = getShareData();

    // Try native share sheet first (works great on iPad/iPhone)
    if (navigator.share) {
      try {
        await navigator.share(data);
        // Track in PostHog
        if (window.posthog) {
          window.posthog.capture('story_shared', {
            method: 'native',
            story_id: story?.id || 'home',
            lang,
          });
        }
        return;
      } catch (e) {
        // User cancelled — not an error, just return silently
        if (e.name === 'AbortError') return;
      }
    }

    // Fallback: copy link to clipboard
    try {
      await navigator.clipboard.writeText(data.url);
      setState('copied');
      if (window.posthog) {
        window.posthog.capture('story_shared', {
          method: 'clipboard',
          story_id: story?.id || 'home',
          lang,
        });
      }
      setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const color = accent || '#fbbf24';

  // Labels
  const labels = {
    idle:   { en: '🔗 Share',      hi: '🔗 शेयर करें' },
    copied: { en: '✓ Link copied', hi: '✓ लिंक कॉपी हुआ' },
    error:  { en: '✗ Try again',   hi: '✗ फिर कोशिश करें' },
  };
  const label = labels[state][lang] || labels[state]['en'];

  // Two visual variants: 'default' (outline) and 'pill' (filled, for ending card)
  const styles = {
    default: {
      padding: '8px 18px',
      borderRadius: 20,
      border: `1px solid ${state === 'copied' ? '#4ade80' : color}66`,
      background: state === 'copied' ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)',
      color: state === 'copied' ? '#4ade80' : color,
      fontFamily: 'var(--mono)',
      fontSize: '0.72rem',
      letterSpacing: '0.08em',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      fontWeight: 600,
    },
    pill: {
      padding: '12px 24px',
      borderRadius: 30,
      border: `1px solid ${state === 'copied' ? '#4ade80' : color}`,
      background: state === 'copied'
        ? 'rgba(74,222,128,0.15)'
        : `linear-gradient(135deg,${color}44,${color}22)`,
      color: state === 'copied' ? '#4ade80' : '#ffffff',
      fontFamily: 'var(--mono)',
      fontSize: '0.78rem',
      letterSpacing: '0.08em',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      fontWeight: 600,
    },
  };

  return (
    <button
      onClick={handleShare}
      style={styles[variant]}
      onMouseEnter={e => { if (state === 'idle') e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
    >
      {label}
    </button>
  );
}
