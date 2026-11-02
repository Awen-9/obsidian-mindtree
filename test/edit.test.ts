import assert from "node:assert/strict";
import { test } from "node:test";
import { addChild, addSibling, deleteNode, moveSibling, setNodeText } from "../src/edit.ts";
import { findByLine, parseOutline, type Outline } from "../src/outline.ts";

const SAMPLE = [
	"---",
	"title: x",
	"---",
	"# A",
	"intro text",
	"- a1",
	"  - a1x",
	"- a2",
	"## B",
	"1. b1",
	"2. b2",
	"",
	"# C",
	"",
].join("\n");

const texts = (o: Outline) => o.root.children.map((n) => n.text);

test("parses headings and lists into one tree", () => {
	const o = parseOutline(SAMPLE, "doc");
	assert.deepEqual(texts(o), ["A", "C"]);
	const a = o.root.children[0];
	assert.deepEqual(a.children.map((n) => n.text), ["a1", "a2", "B"]);
	assert.deepEqual(a.children[0].children.map((n) => n.text), ["a1x"]);
	assert.deepEqual(a.children[2].children.map((n) => n.text), ["b1", "b2"]);
	assert.equal(a.note, "intro text");
	assert.equal(o.indentUnit, "  ");
});

test("ignores frontmatter and fenced code", () => {
	const o = parseOutline("---\n# no\n---\n# yes\n```\n# nope\n- nope\n```\n- item\n", "doc");
	assert.deepEqual(o.nodes.map((n) => n.text), ["yes", "item"]);
});

test("subtree ranges include body text", () => {
	const o = parseOutline(SAMPLE, "doc");
	const a = o.root.children[0];
	assert.equal(a.line, 3);
	assert.equal(a.endLine, 12);
	assert.equal(a.children[0].endLine, 7);
});

test("fold keys stay unique for duplicate siblings", () => {
	const o = parseOutline("- x\n- x\n- y\n", "doc");
	assert.equal(new Set(o.nodes.map((n) => n.key)).size, 3);
});

test("rewriting a node touches exactly one line", () => {
	const o = parseOutline(SAMPLE, "doc");
	const a2 = findByLine(o, 7)!;
	const before = SAMPLE.split("\n");
	const after = setNodeText(o, a2, "renamed\nsecond line").text.split("\n");
	const changed = after.filter((l, i) => l !== before[i]);
	assert.deepEqual(changed, ["- renamed second line"]);
	assert.equal(after.length, before.length);
});

test("addChild under a heading copies the last child's style and lands after its subtree", () => {
	const o = parseOutline(SAMPLE, "doc");
	const res = addChild(o, o.root.children[0]);
	const lines = res.text.split("\n");
	assert.equal(lines[11], "## ");
	assert.equal(res.focusLine, 11);
	assert.equal(lines[12], "");
});

test("addChild under a list item uses the file's indent unit", () => {
	const o = parseOutline(SAMPLE, "doc");
	const res = addChild(o, findByLine(o, 7)!);
	assert.equal(res.text.split("\n")[8], "  - ");
});

test("addSibling continues ordered numbering", () => {
	const o = parseOutline(SAMPLE, "doc");
	const res = addSibling(o, findByLine(o, 10)!);
	assert.equal(res.text.split("\n")[11], "3. ");
});

test("deleteNode removes the whole subtree and keeps spacing", () => {
	const o = parseOutline(SAMPLE, "doc");
	const lines = deleteNode(o, findByLine(o, 5)!).text.split("\n");
	assert.deepEqual(lines.slice(3, 8), ["# A", "intro text", "- a2", "## B", "1. b1"]);
});

test("moveSibling swaps whole subtrees", () => {
	const o = parseOutline(SAMPLE, "doc");
	const res = moveSibling(o, findByLine(o, 7)!, -1);
	assert.deepEqual(res.text.split("\n").slice(5, 8), ["- a2", "- a1", "  - a1x"]);
	assert.equal(res.focusLine, 5);
	assert.equal(moveSibling(o, findByLine(o, 5)!, -1).focusLine, null);
});

test("moveSibling and addSibling keep ordered lists counting up", () => {
	const list = parseOutline("1. x\n2. y\n3. z\n", "doc");
	assert.equal(moveSibling(list, list.nodes[0], 1).text, "1. y\n2. x\n3. z\n");
	const o = parseOutline(SAMPLE, "doc");
	assert.deepEqual(addSibling(o, findByLine(o, 9)!).text.split("\n").slice(9, 12), ["1. b1", "2. ", "3. b2"]);
});

test("CRLF files keep their line endings", () => {
	const crlf = "# A\r\n- x\r\n";
	const o = parseOutline(crlf, "doc");
	assert.deepEqual(o.nodes.map((n) => n.text), ["A", "x"]);
	assert.equal(setNodeText(o, o.nodes[1], "y").text, "# A\r\n- y\r\n");
});

test("an unchanged outline serialises back to the same text", () => {
	const o = parseOutline(SAMPLE, "doc");
	assert.equal(o.lines.join(o.eol), SAMPLE);
});

test("an empty file gets a first heading", () => {
	const o = parseOutline("", "doc");
	assert.equal(addChild(o, o.root).text, "# \n");
});
