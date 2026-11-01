import type { OutlineNode } from "./outline.ts";

export interface LItem {
	node: OutlineNode;
	w: number;
	h: number;
	x: number;
	y: number;
	/** 1 right of the root, -1 left of the root, 0 for the root itself */
	side: -1 | 0 | 1;
	parent: LItem | null;
	children: LItem[];
	/** vertical space this subtree needs */
	sub: number;
}

export interface LayoutOptions {
	hGap: number;
	vGap: number;
}

/** Left-right tree layout. Returns visible items in pre-order, root first. */
export function layoutTree(
	root: OutlineNode,
	isCollapsed: (n: OutlineNode) => boolean,
	measure: (n: OutlineNode) => { w: number; h: number },
	opt: LayoutOptions,
): LItem[] {
	const all: LItem[] = [];
	const stackHeight = (items: LItem[]) =>
		items.reduce((s, c) => s + c.sub, 0) + opt.vGap * Math.max(0, items.length - 1);

	const build = (node: OutlineNode, parent: LItem | null): LItem => {
		const { w, h } = measure(node);
		const item: LItem = { node, w, h, x: 0, y: 0, side: 0, parent, children: [], sub: h };
		all.push(item);
		if (!isCollapsed(node)) item.children = node.children.map((c) => build(c, item));
		item.sub = Math.max(h, stackHeight(item.children));
		return item;
	};

	const setSide = (item: LItem, side: -1 | 1) => {
		item.side = side;
		item.children.forEach((c) => setSide(c, side));
	};

	const place = (items: LItem[], parent: LItem, side: -1 | 1, top: number) => {
		for (const c of items) {
			c.x = side > 0 ? parent.x + parent.w + opt.hGap : parent.x - opt.hGap - c.w;
			c.y = top + c.sub / 2 - c.h / 2;
			place(c.children, c, side, top + (c.sub - stackHeight(c.children)) / 2);
			top += c.sub + opt.vGap;
		}
	};

	const rootItem = build(root, null);
	rootItem.x = -rootItem.w / 2;
	rootItem.y = -rootItem.h / 2;

	const kids = rootItem.children;
	const total = stackHeight(kids);
	let acc = 0;
	let cut = 0;
	while (cut < kids.length && acc < total / 2) acc += kids[cut++].sub;
	const right = kids.slice(0, cut);
	const left = kids.slice(cut);
	right.forEach((c) => setSide(c, 1));
	left.forEach((c) => setSide(c, -1));
	place(right, rootItem, 1, -stackHeight(right) / 2);
	place(left, rootItem, -1, -stackHeight(left) / 2);
	return all;
}
