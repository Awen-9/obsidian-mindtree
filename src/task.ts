import type { EditResult } from "./edit.ts";
import type { Outline, OutlineNode } from "./outline.ts";

const TASK = /^\[([ xX])\]\s+(.*)$/s;

/** A list item written as `- [ ] text` or `- [x] text`. */
export function parseTask(node: OutlineNode): { done: boolean; label: string } | null {
	if (node.kind !== "list") return null;
	const m = TASK.exec(node.text);
	return m ? { done: m[1] !== " ", label: m[2] } : null;
}

export function toggleTask(o: Outline, node: OutlineNode): EditResult {
	const task = parseTask(node);
	const lines = o.lines.slice();
	if (task) {
		const at = node.textStart + 1;
		lines[node.line] = lines[node.line].slice(0, at) + (task.done ? " " : "x") + lines[node.line].slice(at + 1);
	}
	return { text: lines.join(o.eol), focusLine: task ? node.line : null };
}
