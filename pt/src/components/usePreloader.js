// ─────────────────────────────────────────────────────────────
//  usePreloader.js
//  Checks image + audio availability for each node.
//
//  Safari iOS fix: audio checked via HEAD fetch instead of
//  new Audio() + canplaythrough. Safari blocks Audio API
//  without user gesture, so canplaythrough never fires.
//  HEAD fetch works without user gesture on all browsers.
//
//  Returns getAssetState(nodeId) → { imageReady, audioReady }
// ─────────────────────────────────────────────────────────────

import { useRef, useEffect, useCallback } from 'react';

export default function usePreloader(story, currentNodeId, lang) {
  // { [nodeId]: { imageReady: bool, audioReady: bool } }
  const cache = useRef({});

  const preloadNode = useCallback((nodeId) => {
    const node = story.nodes[nodeId];
    if (!node) return;

    if (!cache.current[nodeId]) {
      cache.current[nodeId] = {
        imageReady: !node.image,
        audioReady: false,
      };
    }

    const entry = cache.current[nodeId];

    // ── Image ─────────────────────────────────────────────────
    if (node.image && !entry.imageReady) {
      const img = new Image();
      img.onload  = () => { cache.current[nodeId].imageReady = true; };
      img.onerror = () => { cache.current[nodeId].imageReady = true; };
      img.src = node.image;
    }

    // ── Audio — HEAD fetch (Safari iOS safe) ──────────────────
    // Does not create an Audio object. Just checks the file exists.
    // Marks audioReady=true whether file exists or not — AudioButton
    // handles the missing-file case via its own HEAD fetch.
    if (!entry.audioReady) {
      const src = `/audio/${story.id}/${nodeId}.${lang}.mp3`;
      fetch(src, { method: 'HEAD' })
        .then(() => { cache.current[nodeId].audioReady = true; })
        .catch(() => { cache.current[nodeId].audioReady = true; });
    }
  }, [story, lang]);

  // Check all next nodes whenever current node changes
  useEffect(() => {
    const currentNode = story.nodes[currentNodeId];
    if (!currentNode?.choices) return;
    currentNode.choices.forEach(c => { if (c.next) preloadNode(c.next); });
  }, [currentNodeId, story, preloadNode]);

  // Check start node on mount
  useEffect(() => { preloadNode(currentNodeId); }, []); // eslint-disable-line

  // Reset audio cache on language switch, re-check current + next nodes
  useEffect(() => {
    Object.keys(cache.current).forEach(nodeId => {
      if (story.nodes[nodeId]) {
        cache.current[nodeId].audioReady = false;
      }
    });
    preloadNode(currentNodeId);
    const currentNode = story.nodes[currentNodeId];
    if (currentNode?.choices) {
      currentNode.choices.forEach(c => { if (c.next) preloadNode(c.next); });
    }
  }, [lang]); // eslint-disable-line

  const getAssetState = useCallback((nodeId) => {
    return cache.current[nodeId] || {
      imageReady: !story.nodes[nodeId]?.image,
      audioReady: false,
    };
  }, [story]);

  return { getAssetState, preloadNode };
}
