import { displayText } from "./draw.ts";
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

/** Map each heading to its nearest heading ancestor, or null for top-level headings. */
export function headingParents(headings: OutlineNode[]): Map<OutlineNode, OutlineNode | null> {
	const parents = new Map<OutlineNode, OutlineNode | null>();
	const stack: OutlineNode[] = [];
	for (const n of headings) {
		while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
		parents.set(n, stack[stack.length - 1] ?? null);
		stack.push(n);
	}
	return parents;
}

export interface HeadingTree {
	roots: OutlineNode[];
	children: Map<OutlineNode, OutlineNode[]>;
}

/** Nest the headings into a forest, preserving document order within each level. */
export function headingTree(headings: OutlineNode[]): HeadingTree {
	const parents = headingParents(headings);
	const children = new Map<OutlineNode, OutlineNode[]>();
	for (const n of headings) children.set(n, []);
	const roots: OutlineNode[] = [];
	for (const n of headings) {
		const p = parents.get(n);
		if (p) children.get(p)!.push(n);
		else roots.push(n);
	}
	return { roots, children };
}

export interface TocFilter {
	/** Headings to render: every match plus the ancestors that lead to it. */
	visible: Set<OutlineNode>;
	/** Headings whose own text matched the query. */
	matched: Set<OutlineNode>;
}

/**
 * Headings to show for a query, or null when the query is empty.
 * Matches run against the visible label, so `[[Note|Alias]]` is found by either part.
 */
export function filterHeadings(headings: OutlineNode[], query: string): TocFilter | null {
	const q = query.trim().toLowerCase();
	if (!q) return null;
	const matched = new Set(headings.filter((n) => displayText(n.text).toLowerCase().includes(q)));
	const visible = new Set<OutlineNode>();
	const parents = headingParents(headings);
	for (const m of matched) {
		for (let n: OutlineNode | null = m; n; n = parents.get(n) ?? null) visible.add(n);
	}
	return { visible, matched };
}
