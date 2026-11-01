import { parseOutline, type NodeKind, type Outline, type OutlineNode } from "./outline.ts";

export interface EditResult {
	text: string;
	/** line of the node to select once the new text is parsed */
	focusLine: number | null;
}

const unchanged = (o: Outline): EditResult => ({ text: o.lines.join(o.eol), focusLine: null });

export function cleanText(t: string): string {
	return t.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** End of the subtree ignoring trailing blank lines, so edits keep paragraph spacing. */
function trimmedEnd(o: Outline, node: OutlineNode): number {
	const floor = node.line + 1;
	let k = node.endLine;
	while (k > floor && o.lines[k - 1].trim() === "") k--;
	return k;
}

function prefixOf(o: Outline, node: OutlineNode): string {
	return o.lines[node.line].slice(0, node.textStart);
}

function bumpNumber(prefix: string): string {
	const m = /^(\s*)(\d+)([.)]\s+)$/.exec(prefix);
	return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : prefix;
}

function insertLine(o: Outline, at: number, line: string): EditResult {
	const lines = o.lines.slice();
	lines.splice(at, 0, line);
	return { text: lines.join(o.eol), focusLine: at };
}

export function setNodeText(o: Outline, node: OutlineNode, text: string): EditResult {
	if (node.kind === "root") return unchanged(o);
	const lines = o.lines.slice();
	lines[node.line] = lines[node.line].slice(0, node.textStart) + cleanText(text);
	return { text: lines.join(o.eol), focusLine: node.line };
}

export function addChild(o: Outline, node: OutlineNode): EditResult {
	const last = node.children[node.children.length - 1];
	let prefix: string;
	if (last) prefix = bumpNumber(prefixOf(o, last));
	else if (node.kind === "root") prefix = "# ";
	else if (node.kind === "heading") prefix = node.level < 6 ? `${"#".repeat(node.level + 1)} ` : "- ";
	else prefix = `${/^[ \t]*/.exec(o.lines[node.line])![0]}${o.indentUnit}- `;
	return insertLine(o, trimmedEnd(o, node), prefix);
}

export function addSibling(o: Outline, node: OutlineNode): EditResult {
	if (node.kind === "root") return addChild(o, node);
	return insertLine(o, trimmedEnd(o, node), bumpNumber(prefixOf(o, node)));
}

export function deleteNode(o: Outline, node: OutlineNode): EditResult {
	if (node.kind === "root") return unchanged(o);
	const lines = o.lines.slice();
	lines.splice(node.line, trimmedEnd(o, node) - node.line);
	return { text: lines.join(o.eol), focusLine: null };
}

export type DropPos = "child" | "before" | "after";

const leadingWs = (s: string) => /^[ \t]*/.exec(s)![0];

function isInside(node: OutlineNode, ancestor: OutlineNode): boolean {
	for (let p: OutlineNode | null = node; p; p = p.parent) if (p === ancestor) return true;
	return false;
}

function subtree(node: OutlineNode): OutlineNode[] {
	return [node, ...node.children.flatMap(subtree)];
}

/** New parent and insertion line (original numbering) for a drop, or null when it is not allowed. */
function dropPoint(
	o: Outline,
	kind: NodeKind,
	moving: OutlineNode | null,
	target: OutlineNode,
	pos: DropPos,
): { parent: OutlineNode; at: number } | null {
	if (moving && isInside(target, moving)) return null;
	if (pos !== "child") {
		const parent = target.parent;
		if (!parent || target.kind !== kind) return null;
		return { parent, at: pos === "before" ? target.line : trimmedEnd(o, target) };
	}
	if (kind === "heading" || target.kind === "list") return { parent: target, at: trimmedEnd(o, target) };
	// A list item goes after the heading's own list items, ahead of its sub-headings.
	const lastList = target.children.filter((c) => c.kind === "list").pop();
	if (lastList) return { parent: target, at: trimmedEnd(o, lastList) };
	if (!target.children.length) return { parent: target, at: trimmedEnd(o, target) };
	let at = target.children[0].line;
	while (at > target.line + 1 && o.lines[at - 1].trim() === "") at--;
	return { parent: target, at };
}

/** A run of source lines that is about to be placed under a new parent. */
interface Block {
	lines: string[];
	kind: NodeKind;
	level: number;
	/** leading whitespace of the first line */
	base: string;
	/** heading lines inside the block: offset into `lines` and original level */
	headings: { at: number; level: number }[];
}

/** Rewrite heading levels or list indentation so the block fits under `parent`; null when it cannot. */
function fitBlock(o: Outline, b: Block, parent: OutlineNode, pos: DropPos, target: OutlineNode): string[] | null {
	const block = b.lines.slice();
	if (b.kind === "heading") {
		if (parent.kind === "list") return null;
		const delta = (parent.kind === "root" ? 1 : parent.level + 1) - b.level;
		for (const h of b.headings) {
			const level = h.level + delta;
			if (level < 1 || level > 6) return null;
			block[h.at] = "#".repeat(level) + block[h.at].slice(h.level);
		}
		return block;
	}
	if (parent.kind === "root") return null;
	const lastKid = parent.children[parent.children.length - 1];
	let newBase = "";
	if (parent.kind === "list") {
		if (pos !== "child") newBase = leadingWs(o.lines[target.line]);
		else if (lastKid) newBase = leadingWs(o.lines[lastKid.line]);
		else newBase = leadingWs(o.lines[parent.line]) + o.indentUnit;
	}
	for (let i = 0; i < block.length; i++) {
		if (block[i].trim() === "") continue;
		const rest = block[i].startsWith(b.base) ? block[i].slice(b.base.length) : block[i].trimStart();
		block[i] = newBase + rest;
	}
	return block;
}

/** Re-parent a node with its whole subtree, fixing heading levels or list indentation. */
export function moveNode(o: Outline, node: OutlineNode, target: OutlineNode, pos: DropPos): EditResult {
	if (node.kind === "root") return unchanged(o);
	const drop = dropPoint(o, node.kind, node, target, pos);
	if (!drop) return unchanged(o);
	const { parent, at } = drop;
	const start = node.line;
	const end = trimmedEnd(o, node);
	if (at > start && at < end) return unchanged(o);
	const block = fitBlock(
		o,
		{
			lines: o.lines.slice(start, end),
			kind: node.kind,
			level: node.level,
			base: leadingWs(o.lines[start]),
			headings: subtree(node)
				.filter((n) => n.kind === "heading")
				.map((n) => ({ at: n.line - start, level: n.level })),
		},
		parent,
		pos,
		target,
	);
	if (!block) return unchanged(o);

	const lines = o.lines.slice();
	lines.splice(start, end - start);
	const insertAt = at >= end ? at - (end - start) : at;
	lines.splice(insertAt, 0, ...block);
	return { text: lines.join(o.eol), focusLine: insertAt };
}

/** Markdown of a node and everything under it, indentation removed so it can be pasted anywhere. */
export function copyBlock(o: Outline, node: OutlineNode): string | null {
	if (node.kind === "root") return null;
	const base = leadingWs(o.lines[node.line]);
	return o.lines
		.slice(node.line, trimmedEnd(o, node))
		.map((l) => (l.startsWith(base) ? l.slice(base.length) : l))
		.join("\n");
}

/**
 * Insert Markdown text under `target`, re-levelling headings and re-indenting lists.
 * Text that does not start with a heading or list item becomes one list item per line.
 * Returns null when the text cannot go there.
 */
export function pasteBlock(o: Outline, target: OutlineNode, text: string, pos: DropPos = "child"): EditResult | null {
	let lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	while (lines.length && lines[0].trim() === "") lines.shift();
	while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
	if (!lines.length) return null;
	let parsed = parseOutline(lines.join("\n"), "");
	if (parsed.nodes[0]?.line !== 0) {
		lines = lines.filter((l) => l.trim() !== "").map((l) => `- ${l.trim()}`);
		parsed = parseOutline(lines.join("\n"), "");
	}
	const tops = parsed.root.children;
	if (!tops.length || tops.some((t) => t.kind !== tops[0].kind)) return null;

	const first = tops[0];
	const drop = dropPoint(o, first.kind, null, target, pos);
	if (!drop) return null;
	const block = fitBlock(
		o,
		{
			lines: parsed.lines,
			kind: first.kind,
			level: first.level,
			base: leadingWs(parsed.lines[first.line]),
			headings: parsed.nodes.filter((n) => n.kind === "heading").map((n) => ({ at: n.line, level: n.level })),
		},
		drop.parent,
		pos,
		target,
	);
	if (!block) return null;
	const out = o.lines.slice();
	out.splice(drop.at, 0, ...block);
	return { text: out.join(o.eol), focusLine: drop.at };
}

/** Swap a node with its previous (-1) or next (1) sibling, moving whole subtrees. */
export function moveSibling(o: Outline, node: OutlineNode, dir: -1 | 1): EditResult {
	const siblings = node.parent?.children;
	if (!siblings) return unchanged(o);
	const other = siblings[siblings.indexOf(node) + dir];
	if (!other) return unchanged(o);
	const [a, b] = dir < 0 ? [other, node] : [node, other];
	const aBlock = o.lines.slice(a.line, a.endLine);
	const bBlock = o.lines.slice(b.line, b.endLine);
	const lines = [...o.lines.slice(0, a.line), ...bBlock, ...aBlock, ...o.lines.slice(b.endLine)];
	return { text: lines.join(o.eol), focusLine: dir < 0 ? a.line : a.line + bBlock.length };
}
