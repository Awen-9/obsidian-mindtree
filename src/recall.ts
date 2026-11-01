import { noteOf } from "./note.ts";
import type { Outline, OutlineNode } from "./outline.ts";

/** In recall mode a question is a first-level list item; its children and its note are the answer. */
export function isQuestion(o: Outline, n: OutlineNode): boolean {
	return n.kind === "list" && n.parent?.kind !== "list" && (n.children.length > 0 || noteOf(o, n) !== "");
}

export function questionOf(o: Outline, node: OutlineNode): OutlineNode | null {
	for (let n: OutlineNode | null = node; n; n = n.parent) if (isQuestion(o, n)) return n;
	return null;
}

/** The question whose answer is on screen after selecting `sel`. Selecting the question itself keeps it as it was. */
export function openQuestion(o: Outline, sel: OutlineNode, open: string | null): string | null {
	const q = questionOf(o, sel);
	return q && (q !== sel || q.key === open) ? q.key : null;
}

/** Keys of the questions to fold so that only `open` shows its answer. */
export function recallFolds(o: Outline, open: string | null): string[] {
	return o.nodes.filter((n) => n.children.length > 0 && n.key !== open && isQuestion(o, n)).map((n) => n.key);
}
