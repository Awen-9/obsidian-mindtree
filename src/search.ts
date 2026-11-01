import { displayText } from "./draw.ts";
import type { OutlineNode } from "./outline.ts";

/** Nodes whose visible text or note contains the query, in document order. */
export function findMatches(nodes: OutlineNode[], query: string): OutlineNode[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return nodes.filter((n) => displayText(n.text).toLowerCase().includes(q) || n.note.toLowerCase().includes(q));
}

/** Folded ancestors that must open for `node` to be visible. */
export function foldedAncestors(node: OutlineNode, collapsed: Set<string>): string[] {
	const keys: string[] = [];
	for (let p = node.parent; p; p = p.parent) if (collapsed.has(p.key)) keys.push(p.key);
	return keys;
}
