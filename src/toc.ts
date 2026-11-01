import type { OutlineNode } from "./outline.ts";

/** Headings in document order; they act as the chapters of a note. */
export function tocEntries(nodes: OutlineNode[]): OutlineNode[] {
	return nodes.filter((n) => n.kind === "heading");
}

/** The heading that contains `node`, or the node itself when it is a heading. */
export function activeHeading(node: OutlineNode): OutlineNode | null {
	for (let n: OutlineNode | null = node; n; n = n.parent) if (n.kind === "heading") return n;
	return null;
}
