// ─────────────────────────────────────────────────────────────
// storyValidator.js
// Validates a story's node structure against the platform rules.
// Used by both the Agent flow and the Writer flow before any
// story enters the review pipeline or is pushed to GitHub.
//
// Rules enforced here match Section 4 of the Rules Document.
// ─────────────────────────────────────────────────────────────

export function validateStoryStructure(nodes) {
  const errors = [];

  if (!nodes || typeof nodes !== 'object' || Object.keys(nodes).length === 0) {
    return ['Story has no nodes'];
  }

  const nodeIds   = Object.keys(nodes);
  const endings   = nodeIds.filter(id => nodes[id].isEnding);
  const forks     = nodeIds.filter(id => nodes[id].choices && nodes[id].choices.length >= 2);
  const hasStart  = !!nodes['start'];

  // Fixed rules — these cannot be overridden
  if (!hasStart)            errors.push('No "start" node found — every story must begin with a "start" node');
  if (forks.length === 0)   errors.push('No fork found — at least 1 fork node is required');
  if (endings.length < 2)   errors.push(`Only ${endings.length} ending(s) found — minimum 2 required`);
  if (nodeIds.length > 20)  errors.push(`${nodeIds.length} nodes exceeds the maximum of 20`);

  // Per-node checks
  nodeIds.forEach(id => {
    const node = nodes[id];

    if (!node.isEnding && !node.choices) {
      errors.push(`"${id}" has no choices and is not marked as an ending`);
    }
    if (node.isEnding && !node.lesson) {
      errors.push(`Ending node "${id}" is missing a lesson field`);
    }
    if (node.choices) {
      node.choices.forEach((choice, index) => {
        if (!choice.next) {
          errors.push(`"${id}" choice ${index + 1} has no "next" value`);
        } else if (!nodes[choice.next]) {
          errors.push(`"${id}" → "${choice.next}" — target node does not exist`);
        }
      });
    }
  });

  // Reachability — every node must be reachable from start
  if (hasStart) {
    const reachableNodes = new Set();
    const walkFromNode = (nodeId) => {
      if (reachableNodes.has(nodeId) || !nodes[nodeId]) return;
      reachableNodes.add(nodeId);
      if (nodes[nodeId].choices) {
        nodes[nodeId].choices.forEach(choice => walkFromNode(choice.next));
      }
    };
    walkFromNode('start');
    nodeIds
      .filter(id => !reachableNodes.has(id))
      .forEach(id => errors.push(`"${id}" is unreachable from start`));
  }

  return errors;
}

// Returns the type of a node as a readable string
export function getNodeType(node) {
  if (node.isEnding)                              return 'ending';
  if (node.isAlternate)                           return 'alternate';
  if (node.choices && node.choices.length >= 2)   return 'fork';
  return 'single';
}

// Returns a summary of the story's node composition
export function getStoryComposition(nodes) {
  const nodeIds = Object.keys(nodes || {});
  return {
    totalNodes:     nodeIds.length,
    endingNodes:    nodeIds.filter(id => nodes[id].isEnding).length,
    forkNodes:      nodeIds.filter(id => nodes[id].choices && nodes[id].choices.length >= 2).length,
    alternateNodes: nodeIds.filter(id => nodes[id].isAlternate && !nodes[id].isEnding).length,
    singleNodes:    nodeIds.filter(id => !nodes[id].isEnding && nodes[id].choices && nodes[id].choices.length === 1).length,
  };
}
