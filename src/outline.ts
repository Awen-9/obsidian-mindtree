export type NodeKind = "root" | "heading" | "list";

export interface OutlineNode {
	kind: NodeKind;
	text: string;
	/** 0-based line index in the file, -1 for the virtual root */
	line: number;
	/** column where the editable text begins on the line */
	textStart: number;
	/** heading level (1-6) or indent width of a list item */
	level: number;
	depth: number;
	parent: OutlineNode | null;
	children: OutlineNode[];
	/** exclusive end line of this node's subtree, including body text */
	endLine: number;
	/** stable identity built from the text path, used for fold state */
	key: string;
	note: string;
}

export interface Outline {
	root: OutlineNode;
	lines: string[];
	eol: string;
	indentUnit: string;
	nodes: OutlineNode[];
}

const HEADING = /^(#{1,6})([ \t]+)(.*?)[ \t]*$/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

function indentWidth(s: string): number {
	let w = 0;
	for (const c of s) w += c === "\t" ? 4 : 1;
	return w;
}

function frontmatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== "---") return 0;
	for (let j = 1; j < lines.length; j++) {
		const t = lines[j].trim();
		if (t === "---" || t === "...") return j + 1;
	}
	return 0;
}

function makeNode(kind: NodeKind, text: string, line: number, textStart: number, level: number): OutlineNode {
	return { kind, text, line, textStart, level, depth: 0, parent: null, children: [], endLine: 0, key: "", note: "" };
}

function assignKeys(node: OutlineNode): void {
	const seen = new Map<string, number>();
	for (const child of node.children) {
		const occurrence = seen.get(child.text) ?? 0;
		seen.set(child.text, occurrence + 1);
		child.key = `${node.key}/${occurrence}:${child.text}`;
		assignKeys(child);
	}
}

export function parseOutline(text: string, title: string): Outline {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const root = makeNode("root", title, -1, 0, 0);
	root.endLine = lines.length;
	const nodes: OutlineNode[] = [];
	const stack: OutlineNode[] = [root];
	let indentUnit = "";
	let fence: { ch: string; len: number } | null = null;

	const popWhile = (pred: (n: OutlineNode) => boolean) => {
		while (stack.length > 1 && pred(stack[stack.length - 1])) stack.pop();
	};

	for (let i = frontmatterEnd(lines); i < lines.length; i++) {
		const line = lines[i];
		const f = FENCE.exec(line);
		if (fence) {
			if (f && f[1][0] === fence.ch && f[1].length >= fence.len && f[2].trim() === "") fence = null;
			continue;
		}
		if (f) {
			fence = { ch: f[1][0], len: f[1].length };
			continue;
		}

		let node: OutlineNode;
		const h = HEADING.exec(line);
		if (h) {
			const level = h[1].length;
			popWhile((n) => n.kind === "list" || (n.kind === "heading" && n.level >= level));
			node = makeNode("heading", h[3], i, h[1].length + h[2].length, level);
		} else {
			const l = LIST.exec(line);
			if (!l) continue;
			const width = indentWidth(l[1]);
			if (!indentUnit && l[1]) indentUnit = l[1];
			popWhile((n) => n.kind === "list" && n.level >= width);
			node = makeNode("list", l[4].trimEnd(), i, l[1].length + l[2].length + l[3].length, width);
		}
		const parent = stack[stack.length - 1];
		node.parent = parent;
		node.depth = parent.depth + 1;
		parent.children.push(node);
		nodes.push(node);
		stack.push(node);
	}

	const index = new Map(nodes.map((n, i) => [n, i] as const));
	for (const n of nodes) {
		let last = n;
		while (last.children.length) last = last.children[last.children.length - 1];
		const next = nodes[index.get(last)! + 1];
		n.endLine = next ? next.line : lines.length;
		const bodyEnd = n.children.length ? n.children[0].line : n.endLine;
		n.note = lines.slice(n.line + 1, bodyEnd).join("\n").trim();
	}
	assignKeys(root);
	return { root, lines, eol, indentUnit: indentUnit || "\t", nodes };
}

export function findByKey(o: Outline, key: string): OutlineNode | null {
	if (key === "") return o.root;
	return o.nodes.find((n) => n.key === key) ?? null;
}

export function findByLine(o: Outline, line: number): OutlineNode | null {
	return o.nodes.find((n) => n.line === line) ?? null;
}
