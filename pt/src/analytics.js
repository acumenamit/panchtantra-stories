// ─────────────────────────────────────────────────────────────
//  analytics.js
//  All PostHog event tracking lives here.
//  To set up: replace POSTHOG_KEY below with your real key
//  from https://app.posthog.com → Project Settings → API Keys
// ─────────────────────────────────────────────────────────────

export const POSTHOG_KEY = 'YOUR_POSTHOG_KEY_HERE'; // ← replace this
export const POSTHOG_HOST = 'https://app.posthog.com';

// Call once in index.js to initialise
export function initAnalytics() {
  if (!window.posthog || POSTHOG_KEY === 'YOUR_POSTHOG_KEY_HERE') return;
  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,       // we track manually — cleaner data
    capture_pageview: false,  // we handle this ourselves
    persistence: 'localStorage',
  });
}

// ── Page views ────────────────────────────────────────────────
export function trackPageView(pageName, props = {}) {
  ph('page_view', { page: pageName, ...props });
}

// ── Story events ──────────────────────────────────────────────
export function trackStoryStarted(storyId, lang) {
  ph('story_started', { story_id: storyId, lang });
}

export function trackChoiceMade(storyId, nodeId, choiceText, lang) {
  ph('choice_made', {
    story_id: storyId,
    node_id:  nodeId,
    choice:   choiceText.slice(0, 60), // trim long text
    lang,
  });
}

export function trackStoryCompleted(storyId, nodeId, isAlternatePath, lang) {
  ph('story_completed', {
    story_id:     storyId,
    ending_node:  nodeId,
    alternate:    !!isAlternatePath,
    lang,
  });
}

export function trackStoryRestarted(storyId, lang) {
  ph('story_restarted', { story_id: storyId, lang });
}

export function trackLanguageSwitched(from, to, context) {
  ph('language_switched', { from, to, context });
}

export function trackShared(storyId, method, lang) {
  ph('story_shared', { story_id: storyId || 'home', method, lang });
}

// ── Internal helper ───────────────────────────────────────────
function ph(event, props = {}) {
  try {
    if (window.posthog && POSTHOG_KEY !== 'YOUR_POSTHOG_KEY_HERE') {
      window.posthog.capture(event, props);
    } else {
      // Log locally during development so you can see events firing
      console.log(`[Analytics] ${event}`, props);
    }
  } catch (e) {
    // Never let analytics break the app
  }
}
