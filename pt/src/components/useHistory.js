// ─────────────────────────────────────────────────────────────
//  useHistory.js
//  Tracks per-story reading progress in localStorage.
//  Same interface will be kept when Supabase replaces localStorage
//  in Phase 3 — only the internals change, nothing else in the
//  app needs to change.
//
//  localStorage key: 'pt_history'
//  Shape:
//  {
//    "lion-and-hare": {
//      status: "not_started" | "in_progress" | "completed",
//      current_node: "hare_plan",        // last node reached
//      ending_node: "ending_wisdom",     // set on completion
//      restart_count: 0,
//      lang: "en",
//      last_played: "2026-03-26T10:00Z",
//      choices: [{ node, choice, at }]
//    }
//  }
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pt_history';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — fail silently
  }
}

export default function useHistory() {

  // ── Read ─────────────────────────────────────────────────────

  function getStoryRecord(storyId) {
    const history = load();
    return history[storyId] || { status: 'not_started' };
  }

  function getStoryStatus(storyId) {
    return getStoryRecord(storyId).status || 'not_started';
  }

  function getResumeNode(storyId) {
    const record = getStoryRecord(storyId);
    // Only resume if in_progress — completed stories restart from beginning
    if (record.status === 'in_progress' && record.current_node) {
      return record.current_node;
    }
    return null;
  }

  function getAllHistory() {
    return load();
  }

  // ── Write ─────────────────────────────────────────────────────

  function recordStart(storyId, lang) {
    const history = load();
    const existing = history[storyId] || {};
    // Don't overwrite a completed record when restarting — restart_count handles that
    if (existing.status !== 'completed') {
      history[storyId] = {
        ...existing,
        status: 'in_progress',
        current_node: 'start',
        lang,
        last_played: new Date().toISOString(),
        choices: existing.choices || [],
        restart_count: existing.restart_count || 0,
      };
      save(history);
    }
  }

  function recordNodeReached(storyId, nodeId, lang) {
    const history = load();
    const existing = history[storyId] || {};
    history[storyId] = {
      ...existing,
      status: 'in_progress',
      current_node: nodeId,
      lang,
      last_played: new Date().toISOString(),
    };
    save(history);
  }

  function recordChoice(storyId, nodeId, choiceText, lang) {
    const history = load();
    const existing = history[storyId] || {};
    const choices  = existing.choices || [];
    history[storyId] = {
      ...existing,
      status: 'in_progress',
      current_node: nodeId,
      lang,
      last_played: new Date().toISOString(),
      choices: [...choices, { node: nodeId, choice: choiceText, at: new Date().toISOString() }],
    };
    save(history);
  }

  function recordCompleted(storyId, endingNode, lang) {
    const history = load();
    const existing = history[storyId] || {};
    history[storyId] = {
      ...existing,
      status: 'completed',
      current_node: endingNode,
      ending_node: endingNode,
      lang,
      last_played: new Date().toISOString(),
    };
    save(history);
  }

  function recordRestart(storyId, lang) {
    const history = load();
    const existing = history[storyId] || {};
    history[storyId] = {
      ...existing,
      status: 'in_progress',
      current_node: 'start',
      lang,
      last_played: new Date().toISOString(),
      restart_count: (existing.restart_count || 0) + 1,
      choices: [], // fresh path
    };
    save(history);
  }

  return {
    getStoryStatus,
    getResumeNode,
    getAllHistory,
    recordStart,
    recordNodeReached,
    recordChoice,
    recordCompleted,
    recordRestart,
  };
}
