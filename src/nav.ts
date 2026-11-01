import type { LItem } from "./layout.ts";

export type Dir = "up" | "down" | "left" | "right";

export interface NavResult {
	/** node to select */
	item?: LItem;
	/** the selected node is folded and should be expanded to move into it */
	expand?: boolean;
}

export function navigate(items: LItem[], sel: LItem, dir: Dir): NavResult {
	if (dir === "up" || dir === "down") {
		if (sel.side === 0) return {};
		const sign = dir === "down" ? 1 : -1;
		let best: LItem | undefined;
		let bestDist = Infinity;
		for (const it of items) {
			if (it === sel || it.side !== sel.side || it.node.depth !== sel.node.depth) continue;
			const d = (it.y - sel.y) * sign;
			if (d > 0 && d < bestDist) {
				best = it;
				bestDist = d;
			}
		}
		return { item: best };
	}

	const outward = dir === "right" ? 1 : -1;
	if (sel.side === 0 || sel.side === outward) {
		const kids = sel.children.filter((c) => sel.side !== 0 || c.side === outward);
		if (kids.length) return { item: kids[0] };
		if (sel.node.children.length && !sel.children.length) return { expand: true };
		return {};
	}
	return { item: sel.parent ?? undefined };
}
