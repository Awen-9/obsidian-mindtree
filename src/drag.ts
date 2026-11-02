import type { DropPos } from "./edit.ts";
import type { LItem } from "./layout.ts";
import type { OutlineNode } from "./outline.ts";

export interface DropTarget {
	node: OutlineNode;
	pos: DropPos;
}

export interface DragContext {
	host: HTMLElement;
	nodes: OutlineNode[];
	label: string;
	items(): LItem[];
	elOf(key: string): HTMLElement | undefined;
	toStage(clientX: number, clientY: number): { x: number; y: number };
	isValid(t: DropTarget): boolean;
	/** why nothing can be dropped on a node, shown on the ghost */
	refusal(node: OutlineNode): string;
	/** where the node would land, shown on the ghost while it is over a valid target */
	describe(target: DropTarget): string;
	onDrop(t: DropTarget): void;
	/** the pointer was released without moving */
	onClick?(): void;
}

const DROP_CLASSES = ["mt-drop-child", "mt-drop-before", "mt-drop-after"];
const THRESHOLD = 6;
const PAD = 6;

/** Follow a pointer that went down on a node; once it moves, show drop hints and report the drop. */
export function startDrag(e: PointerEvent, c: DragContext): void {
	const doc = c.host.ownerDocument;
	const sx = e.clientX;
	const sy = e.clientY;
	const moving = new Set(c.nodes);
	const sources = c.nodes.map((n) => c.elOf(n.key));
	let ghost: HTMLElement | null = null;
	let hintEl: HTMLElement | null = null;
	let hit: DropTarget | null = null;
	let hitEl: HTMLElement | null = null;
	let hintText: string | null = null;

	/** The drop under the pointer, or the node that turns the drop down. */
	const locate = (ev: PointerEvent): { target: DropTarget | null; over: OutlineNode | null } => {
		const p = c.toStage(ev.clientX, ev.clientY);
		const it = c.items().find(
			(i) => !moving.has(i.node) && p.x >= i.x - PAD && p.x <= i.x + i.w + PAD && p.y >= i.y - PAD && p.y <= i.y + i.h + PAD,
		);
		if (!it) return { target: null, over: null };
		const t = (p.y - it.y) / it.h;
		const first: DropPos = t < 0.25 ? "before" : t > 0.75 ? "after" : "child";
		for (const pos of first === "child" ? (["child"] as const) : ([first, "child"] as const)) {
			const target = { node: it.node, pos };
			if (c.isValid(target)) return { target, over: null };
		}
		return { target: null, over: it.node };
	};

	const setHit = (next: DropTarget | null) => {
		if (next?.node === hit?.node && next?.pos === hit?.pos) return;
		hitEl?.classList.remove(...DROP_CLASSES);
		hit = next;
		hitEl = next ? (c.elOf(next.node.key) ?? null) : null;
		if (next) hitEl?.classList.add(`mt-drop-${next.pos}`);
	};

	/** Show where the node will land, or why it cannot land there. */
	const setHint = (text: string, refused: boolean) => {
		if (!ghost || !hintEl) return;
		if (text !== hintText) {
			hintText = text;
			hintEl.setText(text);
			hintEl.toggleClass("is-empty", !text);
		}
		ghost.toggleClass("is-refused", refused);
	};

	const move = (ev: PointerEvent) => {
		if (!ghost) {
			if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
			ghost = c.host.createDiv({ cls: "mt-drag-ghost" });
			ghost.createDiv({ cls: "mt-drag-label", text: c.label });
			hintEl = ghost.createDiv({ cls: "mt-drag-hint is-empty" });
			hintText = null;
			for (const el of sources) el?.classList.add("is-drag-source");
		}
		const rect = c.host.getBoundingClientRect();
		ghost.style.left = `${ev.clientX - rect.left + 14}px`;
		ghost.style.top = `${ev.clientY - rect.top + 14}px`;
		const { target, over } = locate(ev);
		setHit(target);
		if (target) setHint(c.describe(target), false);
		else if (over) setHint(c.refusal(over), true);
		else setHint("", false);
	};

	const finish = (drop: boolean) => {
		doc.removeEventListener("pointermove", move);
		doc.removeEventListener("pointerup", up);
		doc.removeEventListener("pointercancel", cancel);
		doc.removeEventListener("keydown", esc, true);
		const target = hit;
		setHit(null);
		ghost?.remove();
		for (const el of sources) el?.classList.remove("is-drag-source");
		if (drop && ghost && target) c.onDrop(target);
		else if (drop && !ghost) c.onClick?.();
	};
	const up = () => finish(true);
	const cancel = () => finish(false);
	const esc = (ev: KeyboardEvent) => {
		if (ev.key !== "Escape") return;
		ev.stopPropagation();
		finish(false);
	};

	doc.addEventListener("pointermove", move);
	doc.addEventListener("pointerup", up);
	doc.addEventListener("pointercancel", cancel);
	doc.addEventListener("keydown", esc, true);
}
