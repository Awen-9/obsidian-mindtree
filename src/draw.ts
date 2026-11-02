import { layoutTree, type LItem } from "./layout.ts";
import type { Bounds } from "./viewport.ts";
import { firstLink } from "./links.ts";
import type { OutlineNode } from "./outline.ts";
import { parseTask } from "./task.ts";

const BRANCH_COLORS = 8;

export interface DrawResult {
	items: LItem[];
	els: Map<string, HTMLElement>;
	bounds: Bounds;
}

/** Text shown on the map: wiki links and markdown links collapse to their label. */
export function displayText(s: string): string {
	return s
		.replace(/!?\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, target: string, alias: string) => alias || target)
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function descendantCount(n: OutlineNode): number {
	return n.children.reduce((s, c) => s + 1 + descendantCount(c), 0);
}

function createNodeEl(stage: HTMLElement, node: OutlineNode, branch: number): HTMLElement {
	const el = stage.createDiv({ cls: `mt-node mt-depth-${Math.min(node.depth, 3)} mt-c${branch}` });
	if (node.kind === "root") el.classList.add("mt-root");
	el.dataset.key = node.key;
	const task = parseTask(node);
	if (task) {
		el.classList.add("mt-task");
		if (task.done) el.classList.add("is-done");
		el.createSpan({ cls: "mt-check" });
	}
	el.createSpan({ cls: "mt-text", text: displayText(task ? task.label : node.text) });
	if (firstLink(node.text)) el.classList.add("mt-has-link");
	if (node.note) {
		el.classList.add("mt-has-note");
		el.title = node.note.slice(0, 300);
	}
	return el;
}

export function drawMap(
	stage: HTMLElement,
	root: OutlineNode,
	collapsed: Set<string>,
	selectedKey: string,
): DrawResult {
	stage.replaceChildren();
	const svg = stage.createSvg("svg", { cls: "mt-edges" });

	const isCollapsed = (n: OutlineNode) => n.children.length > 0 && collapsed.has(n.key);
	const els = new Map<OutlineNode, HTMLElement>();
	const branchOf = new Map<OutlineNode, number>();
	const create = (n: OutlineNode, branch: number) => {
		branchOf.set(n, branch);
		els.set(n, createNodeEl(stage, n, branch));
		if (!isCollapsed(n)) n.children.forEach((c, i) => create(c, n === root ? i % BRANCH_COLORS : branch));
	};
	create(root, 0);

	const items = layoutTree(
		root,
		isCollapsed,
		(n) => ({ w: els.get(n)!.offsetWidth, h: els.get(n)!.offsetHeight }),
		{ hGap: 44, vGap: 10 },
	);

	const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const it of items) {
		const el = els.get(it.node)!;
		el.style.left = `${it.x}px`;
		el.style.top = `${it.y}px`;
		bounds.minX = Math.min(bounds.minX, it.x - 24);
		bounds.minY = Math.min(bounds.minY, it.y - 12);
		bounds.maxX = Math.max(bounds.maxX, it.x + it.w + 24);
		bounds.maxY = Math.max(bounds.maxY, it.y + it.h + 12);

		if (it.parent) drawEdge(svg, it, branchOf.get(it.node)!);
		if (it.side !== 0 && it.node.children.length) addToggle(stage, it, collapsed.has(it.node.key));
	}

	const byKey = new Map<string, HTMLElement>();
	for (const [n, el] of els) byKey.set(n.key, el);
	byKey.get(selectedKey)?.classList.add("is-selected");
	return { items, els: byKey, bounds };
}

function drawEdge(svg: SVGElement, it: LItem, branch: number): void {
	const p = it.parent!;
	const sx = it.side > 0 ? p.x + p.w : p.x;
	const ex = it.side > 0 ? it.x : it.x + it.w;
	const sy = p.y + p.h / 2;
	const ey = it.y + it.h / 2;
	const mx = (sx + ex) / 2;
	svg.createSvg("path", {
		cls: `mt-edge mt-c${branch}`,
		attr: { d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}` },
	});
}

function addToggle(stage: HTMLElement, it: LItem, isFolded: boolean): void {
	const btn = stage.createDiv({ cls: "mt-toggle", text: isFolded ? String(descendantCount(it.node)) : "−" });
	btn.dataset.key = it.node.key;
	if (isFolded) btn.classList.add("is-folded");
	btn.style.left = `${it.side > 0 ? it.x + it.w + 4 : it.x - 4 - 18}px`;
	btn.style.top = `${it.y + it.h / 2 - 9}px`;
}
