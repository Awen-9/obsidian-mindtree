import assert from "node:assert/strict";
import { test } from "node:test";
import { moveNode, type DropPos } from "../src/edit.ts";
import { parseOutline, type Outline, type OutlineNode } from "../src/outline.ts";

const SRC = ["# A", "- a1", "  - a1x", "- a2", "## B", "- b1", "# C", "- c1", ""].join("\n");

function find(o: Outline, text: string): OutlineNode {
	const n = o.nodes.find((x) => x.text === text);
	assert.ok(n, `node ${text} exists`);
	return n;
}

function mv(src: string, what: string, to: string, pos: DropPos): { text: string; out: Outline } {
	const o = parseOutline(src, "doc");
	const res = moveNode(o, find(o, what), find(o, to), pos);
	return { text: res.text, out: parseOutline(res.text, "doc") };
}

const kids = (o: Outline, text: string) => find(o, text).children.map((c) => c.text);
const rootKids = (o: Outline) => o.root.children.map((c) => c.text);

test("a heading becomes the last child of another heading and is re-levelled", () => {
	const { text, out } = mv(SRC, "C", "A", "child");
	assert.deepEqual(rootKids(out), ["A"]);
	assert.deepEqual(kids(out, "A"), ["a1", "a2", "B", "C"]);
	assert.ok(text.includes("## C\n- c1"));
});

test("a nested heading moves to the top level", () => {
	const { text, out } = mv(SRC, "B", "A", "after");
	assert.deepEqual(rootKids(out), ["A", "B", "C"]);
	assert.ok(text.includes("\n# B\n- b1"));
});

test("sub-headings shift together with their parent", () => {
	const src = "# P\n## Q\n### R\n# T\n";
	const { text, out } = mv(src, "P", "T", "child");
	assert.deepEqual(kids(out, "T"), ["P"]);
	assert.ok(text.includes("## P\n### Q\n#### R"));
});

test("a drop that would push a heading past level six is refused", () => {
	const src = "###### deep\n# P\n## Q\n";
	const o = parseOutline(src, "doc");
	const res = moveNode(o, find(o, "P"), find(o, "deep"), "child");
	assert.equal(res.text, src);
});

test("a list item nests under another and picks up its indent", () => {
	const { text, out } = mv(SRC, "a2", "a1", "child");
	assert.deepEqual(kids(out, "a1"), ["a1x", "a2"]);
	assert.ok(text.includes("  - a2\n"));
});

test("a nested list item can move out to a sibling slot", () => {
	const { text, out } = mv(SRC, "a1x", "a2", "before");
	assert.deepEqual(kids(out, "A"), ["a1", "a1x", "a2", "B"]);
	assert.ok(text.includes("- a1\n- a1x\n- a2"));
});

test("a list item with children moves into a heading and keeps its shape", () => {
	const { out } = mv(SRC, "a1", "C", "child");
	assert.deepEqual(kids(out, "C"), ["c1", "a1"]);
	assert.deepEqual(kids(out, "a1"), ["a1x"]);
});

test("a list item dropped on a heading stays ahead of its sub-headings", () => {
	const { out } = mv(SRC, "c1", "A", "child");
	assert.deepEqual(kids(out, "A"), ["a1", "a2", "c1", "B"]);
});

test("a heading with no list items still accepts a list child", () => {
	const { out } = mv("# A\n## B\n# C\n- c1\n", "c1", "A", "child");
	assert.deepEqual(kids(out, "A"), ["c1", "B"]);
});

test("headings reorder around siblings", () => {
	const { out } = mv(SRC, "C", "A", "before");
	assert.deepEqual(rootKids(out), ["C", "A"]);
});

test("invalid drops leave the text untouched", () => {
	const o = parseOutline(SRC, "doc");
	const same = (n: string, t: string, p: DropPos) => moveNode(o, find(o, n), find(o, t), p).text === SRC;
	assert.ok(same("A", "B", "child"), "into own descendant");
	assert.ok(same("A", "A", "child"), "onto itself");
	assert.ok(same("a1", "A", "before"), "list before a heading");
	assert.equal(moveNode(o, find(o, "a1"), o.root, "child").text, SRC, "list onto the root");
	assert.equal(moveNode(o, o.root, find(o, "A"), "child").text, SRC, "moving the root");
});

test("a heading dropped under a list item becomes a list item with its subtree", () => {
	const { text, out } = mv(SRC, "B", "a1", "child");
	assert.deepEqual(kids(out, "a1"), ["a1x", "B"]);
	assert.deepEqual(kids(out, "B"), ["b1"]);
	assert.ok(text.includes("- a1\n  - a1x\n  - B\n    - b1\n- a2\n# C"));
});

test("a converted heading keeps its sub-headings nested and its body text as the item's note", () => {
	const src = "# P\nabout P\n## Q\n- q1\n# T\n- t1\n";
	const { out } = mv(src, "P", "t1", "after");
	assert.deepEqual(kids(out, "T"), ["t1", "P"]);
	assert.deepEqual(kids(out, "P"), ["Q"]);
	assert.deepEqual(kids(out, "Q"), ["q1"]);
	assert.equal(find(out, "P").note, "about P");
});

test("moves renumber ordered lists at the source and the target", () => {
	const src = "# A\n1. x\n2. y\n3. z\n# B\n1. p\n";
	const { text } = mv(src, "x", "p", "after");
	assert.equal(text, "# A\n1. y\n2. z\n# B\n1. p\n2. x\n");
});

test("every node survives a move", () => {
	const o = parseOutline(SRC, "doc");
	const { out } = mv(SRC, "a1", "b1", "child");
	assert.deepEqual(out.nodes.map((n) => n.text).sort(), o.nodes.map((n) => n.text).sort());
});

test("CRLF line endings are preserved", () => {
	const { text } = mv(SRC.replace(/\n/g, "\r\n"), "C", "A", "child");
	assert.ok(!/(^|[^\r])\n/.test(text));
});
