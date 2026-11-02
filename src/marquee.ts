import type { LItem } from "./layout.ts";

export interface MarqueeContext {
	host: HTMLElement;
	items(): LItem[];
	toStage(clientX: number, clientY: number): { x: number; y: number };
	/** called with the nodes under the rectangle whenever that set changes */
	onChange(hit: LItem[]): void;
	onEnd(): void;
}

/** Draw a selection rectangle from a pointer that went down on empty space. */
export function startMarquee(e: PointerEvent, c: MarqueeContext): void {
	const doc = c.host.ownerDocument;
	const rect = c.host.getBoundingClientRect();
	const from = c.toStage(e.clientX, e.clientY);
	const box = c.host.createDiv({ cls: "mt-marquee" });
	let last = "";

	const move = (ev: PointerEvent) => {
		box.style.left = `${Math.min(e.clientX, ev.clientX) - rect.left}px`;
		box.style.top = `${Math.min(e.clientY, ev.clientY) - rect.top}px`;
		box.style.width = `${Math.abs(ev.clientX - e.clientX)}px`;
		box.style.height = `${Math.abs(ev.clientY - e.clientY)}px`;
		const to = c.toStage(ev.clientX, ev.clientY);
		const x0 = Math.min(from.x, to.x);
		const x1 = Math.max(from.x, to.x);
		const y0 = Math.min(from.y, to.y);
		const y1 = Math.max(from.y, to.y);
		const hit = c
			.items()
			.filter((i) => i.node.kind !== "root" && i.x < x1 && i.x + i.w > x0 && i.y < y1 && i.y + i.h > y0);
		const sig = hit.map((i) => i.node.key).join("\n");
		if (sig === last) return;
		last = sig;
		c.onChange(hit);
	};

	const finish = () => {
		doc.removeEventListener("pointermove", move);
		doc.removeEventListener("pointerup", finish);
		doc.removeEventListener("pointercancel", finish);
		box.remove();
		c.onEnd();
	};

	doc.addEventListener("pointermove", move);
	doc.addEventListener("pointerup", finish);
	doc.addEventListener("pointercancel", finish);
	move(e);
}
