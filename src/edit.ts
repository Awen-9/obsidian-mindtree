import { findByLine, parseOutline, type NodeKind, type Outline, type OutlineNode } from "./outline.ts";

export interface EditResult {
	text: string;
	/** line of the node to select once the new text is parsed */
	focusLine: number | null;
	/** new line of each node moved by `moveNodes`, in document order */
	lines?: number[];
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

const ORDERED = /^([ \t]*)(\d{1,9})([.)][ \t]+.*)$/;

/** How the ordered items under one parent were numbered before an edit. */
interface Numbering {
	/** a line of the edited text that holds one of the group's items */
	line: number;
	start: number;
	/** every item had the same number ("1. 1. 1."), so they all keep it */
	lazy: boolean;
}

function numbering(o: Outline, items: OutlineNode[], line: number): Numbering | null {
	const nums = items.flatMap((n) => {
		const m = n.kind === "list" ? ORDERED.exec(o.lines[n.line]) : null;
		return m ? [Number(m[2])] : [];
	});
	if (!nums.length) return null;
	return { line, start: nums[0], lazy: nums.length > 1 && nums.every((n) => n === nums[0]) };
}

/** Count the ordered items of each touched group up again after lines were added, removed or moved. */
function renumber(lines: string[], groups: (Numbering | null)[]): void {
	const todo = groups.filter((g): g is Numbering => g !== null);
	if (!todo.length) return;
	const o = parseOutline(lines.join("\n"), "");
	for (const g of todo) {
		const parent = findByLine(o, g.line)?.parent;
		if (!parent) continue;
		let i = 0;
		for (const c of parent.children) {
			const m = c.kind === "list" ? ORDERED.exec(lines[c.line]) : null;
			if (m) lines[c.line] = `${m[1]}${g.lazy ? g.start : g.start + i++}${m[3]}`;
		}
	}
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
	const at = trimmedEnd(o, node);
	const lines = o.lines.slice();
	lines.splice(at, 0, bumpNumber(prefixOf(o, node)));
	if (node.kind === "list") renumber(lines, [numbering(o, node.parent!.children, at)]);
	return { text: lines.join(o.eol), focusLine: at };
}

export function deleteNode(o: Outline, node: OutlineNode): EditResult {
	return deleteNodes(o, [node]);
}

/** Delete several nodes with their subtrees in one edit. */
export function deleteNodes(o: Outline, nodes: OutlineNode[]): EditResult {
	const tops = topmost(nodes);
	if (!tops.length) return unchanged(o);
	const gone = new Set(tops);
	const ranges = tops.map((n) => ({ start: n.line, end: trimmedEnd(o, n) }));
	const groups = [...new Set(tops.filter((n) => n.kind === "list").map((n) => n.parent!))].map((p) => {
		const kept = p.children.find((c) => c.kind === "list" && !gone.has(c));
		return kept ? numbering(o, p.children, afterRemoval(ranges, kept.line)) : null;
	});
	const lines = o.lines.slice();
	for (const r of [...ranges].reverse()) lines.splice(r.start, r.end - r.start);
	renumber(lines, groups);
	return { text: lines.join(o.eol), focusLine: null };
}

/** Where a line outside the removed ranges ends up once they are gone. */
function afterRemoval(ranges: { start: number; end: number }[], line: number): number {
	return ranges.reduce((l, r) => (r.end <= line ? l - (r.end - r.start) : l), line);
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

/** The given nodes without the root and without any node inside another given node, in document order. */
export function topmost(nodes: OutlineNode[]): OutlineNode[] {
	const set = new Set(nodes.filter((n) => n.kind !== "root"));
	const covered = (n: OutlineNode) => {
		for (let p = n.parent; p; p = p.parent) if (set.has(p)) return true;
		return false;
	};
	return [...set].filter((n) => !covered(n)).sort((a, b) => a.line - b.line);
}

/** New parent and insertion line (original numbering) for a drop, or null when it is not allowed. */
function dropPoint(
	o: Outline,
	kind: NodeKind,
	target: OutlineNode,
	pos: DropPos,
): { parent: OutlineNode; at: number } | null {
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
	/** nodes inside the block in document order; the first one sits at the block's top level */
	nodes: OutlineNode[];
	/** line number of `lines[0]` in the outline the nodes come from */
	start: number;
}

/**
 * Headings dropped together with list items, or onto a list item, become list items,
 * since Markdown cannot put a heading inside a list.
 */
function dropKind(kinds: NodeKind[], target: OutlineNode): NodeKind {
	return kinds.every((k) => k === "heading") && target.kind !== "list" ? "heading" : "list";
}

/** Turn the block's headings into list items nested by depth; the text under each heading moves in under its item. */
function headingsToList(b: Block, unit: string): string[] {
	const heads = new Map(b.nodes.filter((n) => n.kind === "heading").map((n) => [n.line - b.start, n]));
	const top = b.nodes[0].depth;
	let pad = "";
	return b.lines.map((l, i) => {
		const h = heads.get(i);
		if (!h) return l.trim() === "" ? l : pad + l;
		const own = unit.repeat(h.depth - top);
		pad = own + unit;
		return `${own}- ${h.text}`;
	});
}

/** Rewrite heading levels or list indentation so the block fits under `parent` as `kind`; null when it cannot. */
function fitBlock(
	o: Outline,
	b: Block,
	kind: NodeKind,
	parent: OutlineNode,
	pos: DropPos,
	target: OutlineNode,
): string[] | null {
	const first = b.nodes[0];
	if (kind === "heading") {
		const block = b.lines.slice();
		const delta = (parent.kind === "root" ? 1 : parent.level + 1) - first.level;
		for (const h of b.nodes) {
			if (h.kind !== "heading") continue;
			const at = h.line - b.start;
			const level = h.level + delta;
			if (level < 1 || level > 6) return null;
			block[at] = "#".repeat(level) + block[at].slice(h.level);
		}
		return block;
	}
	if (parent.kind === "root") return null;
	const block = b.nodes.some((n) => n.kind === "heading") ? headingsToList(b, o.indentUnit) : b.lines.slice();
	const base = leadingWs(block[first.line - b.start]);
	const lastKid = parent.children[parent.children.length - 1];
	let newBase = "";
	if (parent.kind === "list") {
		if (pos !== "child") newBase = leadingWs(o.lines[target.line]);
		else if (lastKid) newBase = leadingWs(o.lines[lastKid.line]);
		else newBase = leadingWs(o.lines[parent.line]) + o.indentUnit;
	}
	for (let i = 0; i < block.length; i++) {
		if (block[i].trim() === "") continue;
		const rest = block[i].startsWith(base) ? block[i].slice(base.length) : block[i].trimStart();
		block[i] = newBase + rest;
	}
	return block;
}

/** Re-parent a node with its whole subtree, fixing heading levels or list indentation. */
export function moveNode(o: Outline, node: OutlineNode, target: OutlineNode, pos: DropPos): EditResult {
	return moveNodes(o, [node], target, pos);
}

/**
 * Move several nodes to the same drop point; they keep their document order.
 * Headings become list items when they land in a list or travel with list items.
 */
export function moveNodes(o: Outline, nodes: OutlineNode[], target: OutlineNode, pos: DropPos): EditResult {
	const tops = topmost(nodes);
	if (!tops.length || tops.some((n) => isInside(target, n))) return unchanged(o);
	const kind = dropKind(
		tops.map((n) => n.kind),
		target,
	);
	const drop = dropPoint(o, kind, target, pos);
	if (!drop) return unchanged(o);
	const { parent, at } = drop;
	const ranges = tops.map((n) => ({ node: n, start: n.line, end: trimmedEnd(o, n) }));
	if (ranges.some((r) => at > r.start && at < r.end)) return unchanged(o);

	const blocks: string[] = [];
	const offsets: number[] = [];
	for (const { node, start, end } of ranges) {
		const block = fitBlock(o, { lines: o.lines.slice(start, end), nodes: subtree(node), start }, kind, parent, pos, target);
		if (!block) return unchanged(o);
		offsets.push(blocks.length);
		blocks.push(...block);
	}

	const lines = o.lines.slice();
	let insertAt = at;
	for (const { start, end } of [...ranges].reverse()) {
		lines.splice(start, end - start);
		if (at >= end) insertAt -= end - start;
	}
	lines.splice(insertAt, 0, ...blocks);

	// A line that stayed put, followed through the removal and the insertion.
	const finalLine = (line: number) => {
		const l = afterRemoval(ranges, line);
		return l >= insertAt ? l + blocks.length : l;
	};
	const gone = new Set(tops);
	const groups = [...new Set(tops.filter((n) => n.kind === "list").map((n) => n.parent!))].map((p) => {
		const kept = p.children.find((c) => c.kind === "list" && !gone.has(c));
		return kept ? numbering(o, p.children, finalLine(kept.line)) : null;
	});
	if (kind === "list") groups.push(numbering(o, parent.children, insertAt));
	renumber(lines, groups);
	return { text: lines.join(o.eol), focusLine: insertAt, lines: offsets.map((d) => insertAt + d) };
}

/** Why `moveNodes` turns down dropping `nodes` into `target`, to tell the user while dragging. */
export function dropRefusal(nodes: OutlineNode[], target: OutlineNode): "inside" | "root" | "depth" | "same" {
	const tops = topmost(nodes);
	if (tops.some((n) => isInside(target, n))) return "inside";
	const kind = dropKind(
		tops.map((n) => n.kind),
		target,
	);
	if (kind === "list") return target.kind === "root" ? "root" : "same";
	const top = target.kind === "root" ? 1 : target.level + 1;
	const deep = tops.some((n) => subtree(n).some((h) => h.kind === "heading" && h.level - n.level + top > 6));
	return deep ? "depth" : "same";
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
	if (!tops.length) return null;

	const kind = dropKind(
		tops.map((n) => n.kind),
		target,
	);
	const drop = dropPoint(o, kind, target, pos);
	if (!drop) return null;
	const block = fitBlock(o, { lines: parsed.lines, nodes: parsed.nodes, start: 0 }, kind, drop.parent, pos, target);
	if (!block) return null;
	const out = o.lines.slice();
	out.splice(drop.at, 0, ...block);
	if (kind === "list") renumber(out, [numbering(o, drop.parent.children, drop.at)]);
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
	const focusLine = dir < 0 ? a.line : a.line + bBlock.length;
	if (node.kind === "list") renumber(lines, [numbering(o, siblings, focusLine)]);
	return { text: lines.join(o.eol), focusLine };
}
