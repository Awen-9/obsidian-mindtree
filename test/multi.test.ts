import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteNodes, moveNodes, topmost } from "../src/edit.ts";
import { parseOutline, type Outline, type OutlineNode } from "../src/outline.ts";

const SRC = ["# A", "- a1", "  - a1x", "- a2", "## B", "- b1", "# C", "- c1", ""].join("\n");

function find(o: Outline, text: string): OutlineNode {
	const n = o.nodes.find((x) => x.text === text);
	assert.ok(n, `node ${text} exists`);
	return n;
}

const pick = (o: Outline, ...texts: string[]) => texts.map((t) => find(o, t));
const kids = (o: Outline, text: string) => find(o, text).children.map((c) => c.text);

test("topmost drops the root and nodes inside other picked nodes, in document order", () => {
	const o = parseOutline(SRC, "doc");
	const tops = topmost([find(o, "c1"), o.root, find(o, "a1x"), find(o, "a1")]);
	assert.deepEqual(
		tops.map((n) => n.text),
		["a1", "c1"],
	);
});

test("deleteNodes removes every picked subtree in one edit", () => {
	const o = parseOutline(SRC, "doc");
	const res = deleteNodes(o, pick(o, "b1", "a1x", "a1"));
	assert.equal(res.text, ["# A", "- a2", "## B", "# C", "- c1", ""].join("\n"));
});

test("moveNodes gathers items from different branches under one heading", () => {
	const o = parseOutline(SRC, "doc");
	const res = moveNodes(o, pick(o, "c1", "a1"), find(o, "B"), "child");
	const out = parseOutline(res.text, "doc");
	assert.deepEqual(kids(out, "A"), ["a2", "B"]);
	assert.deepEqual(kids(out, "B"), ["b1", "a1", "c1"]);
	assert.deepEqual(kids(out, "a1"), ["a1x"]);
	assert.deepEqual(
		res.lines?.map((l) => out.lines[l]),
		["- a1", "- c1"],
	);
});

test("moveNodes re-indents several items under a list item", () => {
	const o = parseOutline(SRC, "doc");
	const res = moveNodes(o, pick(o, "b1", "c1"), find(o, "a2"), "child");
	assert.ok(res.text.includes("- a2\n  - b1\n  - c1\n## B"));
});

test("moveNodes refuses drops inside a moving branch", () => {
	const o = parseOutline(SRC, "doc");
	assert.equal(moveNodes(o, pick(o, "a1", "c1"), find(o, "a1x"), "child").text, SRC);
});

test("moveNodes turns headings moved together with list items into list items", () => {
	const o = parseOutline(SRC, "doc");
	const res = moveNodes(o, pick(o, "B", "c1"), find(o, "C"), "child");
	assert.equal(res.text, ["# A", "- a1", "  - a1x", "- a2", "# C", "- B", "  - b1", "- c1", ""].join("\n"));
});

test("deleteNodes renumbers the ordered items that are left", () => {
	const o = parseOutline("1. a\n2. b\n3. c\n4. d\n", "doc");
	assert.equal(deleteNodes(o, pick(o, "a", "c")).text, "1. b\n2. d\n");
});

test("lazy numbering stays lazy", () => {
	const o = parseOutline("1. a\n1. b\n1. c\n", "doc");
	assert.equal(deleteNodes(o, pick(o, "a")).text, "1. b\n1. c\n");
});
