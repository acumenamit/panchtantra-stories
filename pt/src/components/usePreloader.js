// ─────────────────────────────────────────────────────────────
//  usePreloader.js
//  Silently preloads image + audio for every possible next node
//  while the user is reading the current node.
//
//  Returns getAssetState(nodeId) → { imageReady, audioReady }
//  so StoryEngine can decide whether to show the status line.
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
        imageReady: !node.image,  // no image field → instantly ready
        audioReady: !node.audio,  // no audio field → instantly ready
      };
    }

    const entry = cache.current[nodeId];

    // ── Image ──────────────────────────────────────────────────
    if (node.image && !entry.imageReady) {
      const img = new Image();
      img.onload  = () => { cache.current[nodeId].imageReady = true; };
      img.onerror = () => { cache.current[nodeId].imageReady = true; };
      img.src = node.image;
    }

    // ── Audio ──────────────────────────────────────────────────
    // Path: /audio/{story.id}/{nodeId}.{lang}.mp3
    // If file doesn't exist (story not yet generated), marks ready
    // immediately so "Loading audio..." is never shown for missing files.
    if (!entry.audioReady) {
      const src = `/audio/${story.id}/${nodeId}.${lang}.mp3`;
      const audio = new window.Audio();
      audio.preload = 'auto';
      audio.addEventListener('canplaythrough', () => {
        cache.current[nodeId].audioReady = true;
      }, { once: true });
      audio.addEventListener('error', () => {
        cache.current[nodeId].audioReady = true; // missing = no loading text
      }, { once: true });
      audio.src = src;
    }
  }, [story, lang]);

  // Preload all next nodes whenever current node changes
  useEffect(() => {
    const currentNode = story.nodes[currentNodeId];
    if (!currentNode?.choices) return;
    currentNode.choices.forEach(c => { if (c.next) preloadNode(c.next); });
  }, [currentNodeId, story, preloadNode]);

  // Preload start node on mount
  useEffect(() => { preloadNode(currentNodeId); }, []); // eslint-disable-line

  // Reset audio cache on language switch (different .mp3 files needed)
  useEffect(() => {
    Object.keys(cache.current).forEach(nodeId => {
      if (story.nodes[nodeId]) {
        cache.current[nodeId].audioReady = false;
      }
    });
    const currentNode = story.nodes[currentNodeId];
    if (currentNode?.choices) {
      currentNode.choices.forEach(c => { if (c.next) preloadNode(c.next); });
    }
  }, [lang]); // eslint-disable-line

  const getAssetState = useCallback((nodeId) => {
    return cache.current[nodeId] || {
      imageReady: !story.nodes[nodeId]?.image,
      audioReady: true,
    };
  }, [story]);

  return { getAssetState, preloadNode };
}
