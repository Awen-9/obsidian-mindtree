import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutTree, type LItem } from "../src/layout.ts";
import { navigate } from "../src/nav.ts";
import { parseOutline } from "../src/outline.ts";

const SIZE = { w: 100, h: 30 };
const opt = { hGap: 40, vGap: 10 };
const SOURCE = "# A\n- a1\n- a2\n# B\n- b1\n# C\n# D\n- d1\n  - d1x\n";

function lay(collapsed: string[] = []): LItem[] {
	const o = parseOutline(SOURCE, "doc");
	return layoutTree(o.root, (n) => collapsed.includes(n.key), () => SIZE, opt);
}

const overlaps = (a: LItem, b: LItem) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("no two visible nodes overlap", () => {
	const items = lay();
	for (let i = 0; i < items.length; i++)
		for (let j = i + 1; j < items.length; j++) assert.equal(overlaps(items[i], items[j]), false);
});

test("root is centred and branches split across both sides", () => {
	const items = lay();
	const root = items[0];
	assert.equal(root.x + root.w / 2, 0);
	assert.equal(root.y + root.h / 2, 0);
	assert.ok(items.some((i) => i.side === 1));
	assert.ok(items.some((i) => i.side === -1));
});

test("folded nodes hide their descendants", () => {
	const o = parseOutline(SOURCE, "doc");
	const a = o.root.children[0];
	const items = layoutTree(o.root, (n) => n === a, () => SIZE, opt);
	assert.equal(items.some((i) => i.node.text === "a1"), false);
	assert.equal(items.some((i) => i.node.text === "A"), true);
});

test("a parent is vertically centred on its children", () => {
	const items = lay();
	const d = items.find((i) => i.node.text === "D")!;
	const kids = d.children;
	const top = kids[0].y;
	const bottom = kids[kids.length - 1].y + kids[kids.length - 1].h;
	assert.equal(d.y + d.h / 2, (top + bottom) / 2);
});

test("arrow keys move outward, inward and between siblings", () => {
	const items = lay();
	const root = items[0];
	const right = root.children.find((c) => c.side === 1)!;
	assert.equal(navigate(items, root, "right").item, right);
	const child = right.children[0];
	assert.equal(navigate(items, right, "right").item, child);
	assert.equal(navigate(items, child, "left").item, right);
	const next = navigate(items, right, "down").item;
	assert.equal(next?.parent, root);
	assert.equal(navigate(items, root, "up").item, undefined);
});

test("moving into a folded node asks for expansion", () => {
	const o = parseOutline(SOURCE, "doc");
	const a = o.root.children[0];
	const items = layoutTree(o.root, (n) => n === a, () => SIZE, opt);
	const item = items.find((i) => i.node === a)!;
	const dir = item.side === 1 ? "right" : "left";
	assert.equal(navigate(items, item, dir).expand, true);
});
