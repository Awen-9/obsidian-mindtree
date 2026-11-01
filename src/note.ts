import type { EditResult } from "./edit.ts";
import { parseOutline, type Outline, type OutlineNode } from "./outline.ts";

const blank = (l: string) => l.trim() === "";

function bodyRange(node: OutlineNode): [number, number] {
	return [node.line + 1, node.children.length ? node.children[0].line : node.endLine];
}

/** Body text under a node, up to its first child, with the list indentation removed. */
export function noteOf(o: Outline, node: OutlineNode): string {
	if (node.kind === "root") return "";
	const [s, e] = bodyRange(node);
	const lines = o.lines.slice(s, e);
	const indents = lines.filter((l) => !blank(l)).map((l) => /^[ \t]*/.exec(l)![0].length);
	const cut = indents.length ? Math.min(...indents) : 0;
	return lines
		.map((l) => l.slice(Math.min(cut, /^[ \t]*/.exec(l)![0].length)))
		.join("\n")
		.replace(/^(?:[ \t]*\n)+/, "")
		.replace(/\s+$/, "");
}

/** True when the text holds heading or list lines, which would turn into nodes instead of staying a note. */
export function noteHasNodes(text: string): boolean {
	return parseOutline(text, "").nodes.length > 0;
}

/** Replace the body under a node. Blank lines around the old body are kept so spacing does not shift. */
export function setNodeNote(o: Outline, node: OutlineNode, text: string): EditResult {
	if (node.kind === "root") return { text: o.lines.join(o.eol), focusLine: null };
	const [s, e] = bodyRange(node);
	const old = o.lines.slice(s, e);
	let lead = 0;
	while (lead < old.length && blank(old[lead])) lead++;
	const allBlank = lead === old.length;
	let trail = 0;
	while (trail < old.length && blank(old[old.length - 1 - trail])) trail++;

	const body = text
		.replace(/^(?:[ \t]*\r?\n)+/, "")
		.replace(/\s+$/, "")
		.split(/\r?\n/)
		.filter((_l, i, all) => all.length > 1 || all[0] !== "");
	const ws = /^[ \t]*/.exec(o.lines[node.line])![0];
	const pad = node.kind === "list" ? ws + " ".repeat(Math.max(2, node.textStart - ws.length)) : "";
	const indented = body.map((l) => (blank(l) ? "" : pad + l));

	const next = body.length
		? [...Array<string>(allBlank ? 0 : lead).fill(""), ...indented, ...Array<string>(trail).fill("")]
		: Array<string>(trail).fill("");
	const lines = [...o.lines.slice(0, s), ...next, ...o.lines.slice(e)];
	return { text: lines.join(o.eol), focusLine: node.line };
}
