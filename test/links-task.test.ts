import assert from "node:assert/strict";
import { test } from "node:test";
import { firstLink } from "../src/links.ts";
import { parseOutline } from "../src/outline.ts";
import { parseTask, toggleTask } from "../src/task.ts";

const outline = (lines: string[]) => parseOutline(lines.join("\n"), "t");

test("parseTask reads the mark and label of a list item", () => {
	const o = outline(["# A", "- [ ] 背 HashMap", "- [x] 背 JVM", "- [X] 背 GC", "- [] 不是任务", "- plain"]);
	const [open, done, upper, empty, plain] = o.root.children[0].children;
	assert.deepEqual(parseTask(open), { done: false, label: "背 HashMap" });
	assert.deepEqual(parseTask(done), { done: true, label: "背 JVM" });
	assert.equal(parseTask(upper)?.done, true);
	assert.equal(parseTask(empty), null);
	assert.equal(parseTask(plain), null);
});

test("headings are never tasks", () => {
	const o = outline(["# [ ] title"]);
	assert.equal(parseTask(o.root.children[0]), null);
});

test("toggleTask flips only the mark and keeps indentation and the rest", () => {
	const o = outline(["# A", "- [ ] one", "  - [x] two [[n]]"]);
	const [one] = o.root.children[0].children;
	const two = one.children[0];
	assert.equal(toggleTask(o, one).text, ["# A", "- [x] one", "  - [x] two [[n]]"].join("\n"));
	assert.equal(toggleTask(o, two).text, ["# A", "- [ ] one", "  - [ ] two [[n]]"].join("\n"));
	assert.equal(toggleTask(o, one).focusLine, one.line);
});

test("toggleTask leaves a non-task untouched", () => {
	const o = outline(["# A", "- plain"]);
	const res = toggleTask(o, o.root.children[0].children[0]);
	assert.equal(res.text, "# A\n- plain");
	assert.equal(res.focusLine, null);
});

test("firstLink finds wiki links, dropping alias and keeping heading", () => {
	assert.deepEqual(firstLink("见 [[HashMap 原理#扩容|扩容]]"), { external: false, target: "HashMap 原理#扩容" });
	assert.deepEqual(firstLink("[[a]] 和 [[b]]"), { external: false, target: "a" });
});

test("firstLink separates external urls from note paths", () => {
	assert.deepEqual(firstLink("[文档](https://example.com/a?b=1)"), { external: true, target: "https://example.com/a?b=1" });
	assert.deepEqual(firstLink("[笔记](notes/%E9%9B%86%E5%90%88.md)"), { external: false, target: "notes/集合.md" });
	assert.deepEqual(firstLink("[x](<my note.md>)"), { external: false, target: "my note.md" });
});

test("firstLink skips embeds and plain text", () => {
	assert.equal(firstLink("![[pic.png]]"), null);
	assert.equal(firstLink("![alt](pic.png)"), null);
	assert.deepEqual(firstLink("![[pic.png]] [[real]]"), { external: false, target: "real" });
	assert.equal(firstLink("没有链接 [ ] 也没有"), null);
});
