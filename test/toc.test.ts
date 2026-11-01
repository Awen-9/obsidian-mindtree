import assert from "node:assert/strict";
import { test } from "node:test";
import { findByLine, parseOutline } from "../src/outline.ts";
import { activeHeading, filterHeadings, headingTree, tocEntries } from "../src/toc.ts";

const DOC = [
	"# Java",
	"## 集合",
	"- HashMap 原理",
	"  - 数组加链表",
	"### 并发集合",
	"- ConcurrentHashMap",
	"```",
	"# 不是标题",
	"```",
	"## JVM",
	"- 内存模型",
].join("\n");

test("the table of contents lists headings only, skipping fenced code", () => {
	const o = parseOutline(DOC, "t");
	assert.deepEqual(
		tocEntries(o.nodes).map((n) => n.text),
		["Java", "集合", "并发集合", "JVM"],
	);
});

test("the active heading is the nearest one above the node", () => {
	const o = parseOutline(DOC, "t");
	const at = (line: number) => findByLine(o, line)!;
	assert.equal(activeHeading(at(3))?.text, "集合");
	assert.equal(activeHeading(at(5))?.text, "并发集合");
	assert.equal(activeHeading(at(1))?.text, "集合");
	assert.equal(activeHeading(o.root), null);
});

test("heading depth gives the indent level in the table of contents", () => {
	const o = parseOutline(DOC, "t");
	assert.deepEqual(
		tocEntries(o.nodes).map((n) => n.depth),
		[1, 2, 3, 2],
	);
});

test("headings nest by level into a forest", () => {
	const o = parseOutline(DOC, "t");
	const tree = headingTree(tocEntries(o.nodes));
	assert.deepEqual(tree.roots.map((n) => n.text), ["Java"]);
	const java = tree.roots[0];
	assert.deepEqual((tree.children.get(java) ?? []).map((n) => n.text), ["集合", "JVM"]);
	const jihe = tree.children.get(java)![0];
	assert.deepEqual((tree.children.get(jihe) ?? []).map((n) => n.text), ["并发集合"]);
});

test("filterHeadings keeps matches and their ancestors", () => {
	const o = parseOutline(DOC, "t");
	const headings = tocEntries(o.nodes);
	const f = filterHeadings(headings, "并发")!;
	assert.deepEqual([...f.matched].map((n) => n.text), ["并发集合"]);
	assert.deepEqual([...f.visible].map((n) => n.text).sort(), ["Java", "并发集合", "集合"].sort());
	assert.equal(filterHeadings(headings, ""), null);
	assert.equal(filterHeadings(headings, "   "), null);
});

test("filterHeadings matches the visible label of wiki links", () => {
	const o = parseOutline("# [[target|可见名称]]\n## 其他\n", "t");
	const headings = tocEntries(o.nodes);
	const f = filterHeadings(headings, "可见")!;
	assert.deepEqual([...f.matched].map((n) => n.text), ["[[target|可见名称]]"]);
});
