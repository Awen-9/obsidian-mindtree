import assert from "node:assert/strict";
import { test } from "node:test";
import { findByLine, parseOutline } from "../src/outline.ts";
import { activeHeading, tocEntries } from "../src/toc.ts";

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
