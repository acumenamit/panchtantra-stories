// The ending count (Step 10c; design p1-step10-design.md D11-P13, §4.2 steps 4 and 6, §5; spec
// §6.1 player "Ending x of y found", §6.2 endingsFound). Pure and framework-free.
// - x = |(storedEndings ∪ sessionEndings) ∩ endingIds|: the endings found on this device that are
//   still endings of this story. Stored ids that are no longer endings (the record keeps them,
//   records.ts) and any other id are never counted.
// - sessionEndings are the endings this page reached (the engine's recordEnding effects), so the
//   ending just found counts at once, before the controller's save lands, and the count works with
//   storage blocked (spec §6.2: the stores fall to memory).
// - y = endingIds.length (the story's ending nodes, resume.ts endingIdsOf).
// Imports are relative (C15): Vitest has no `@/` alias.

/** How many of the story's endings were found: stored or found this session, current ids only. */
export function endingCountOf(
  endingIds: readonly string[],
  storedEndings: readonly string[],
  sessionEndings: readonly string[],
): number {
  const found = new Set([...storedEndings, ...sessionEndings])
  return endingIds.filter((id) => found.has(id)).length
}
