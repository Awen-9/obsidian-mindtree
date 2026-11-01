import assert from "node:assert/strict";
import { test } from "node:test";
import { copyBlock, pasteBlock } from "../src/edit.ts";
import { noteHasNodes, noteOf, setNodeNote } from "../src/note.ts";
import { parseOutline, type Outline } from "../src/outline.ts";

const parse = (lines: string[]): Outline => parseOutline(lines.join("\n"), "t");
const at = (o: Outline, text: string) => o.nodes.find((n) => n.text === text)!;

const DOC = [
	"# 集合",
	"",
	"## HashMap",
	"- 原理",
	"  - 数组加链表",
	"  - 红黑树",
	"- 扩容",
	"",
	"## ArrayList",
	"- 动态数组",
];

test("copyBlock dedents a list subtree and keeps headings whole", () => {
	const o = parse(DOC);
	assert.equal(copyBlock(o, at(o, "原理")), "- 原理\n  - 数组加链表\n  - 红黑树");
	assert.equal(copyBlock(o, at(o, "ArrayList")), "## ArrayList\n- 动态数组");
	assert.equal(copyBlock(o, o.root), null);
});

test("paste a list subtree under a list item indents it one level", () => {
	const o = parse(DOC);
	const res = pasteBlock(o, at(o, "扩容"), "- 负载因子\n  - 0.75")!;
	assert.deepEqual(res.text.split("\n").slice(3, 10), [
		"- 原理",
		"  - 数组加链表",
		"  - 红黑树",
		"- 扩容",
		"  - 负载因子",
		"    - 0.75",
		"",
	]);
	assert.equal(res.focusLine, 7);
});

test("paste under a heading puts list items after its own list, before sub-headings", () => {
	const o = parse(["# A", "- x", "## B", "- y"]);
	const res = pasteBlock(o, at(o, "A"), "- new")!;
	assert.equal(res.text, "# A\n- x\n- new\n## B\n- y");
});

test("paste headings re-levels them under the target", () => {
	const o = parse(DOC);
	const res = pasteBlock(o, at(o, "ArrayList"), "# 新章\n## 小节\n- a")!;
	assert.deepEqual(res.text.split("\n").slice(8), ["## ArrayList", "- 动态数组", "### 新章", "#### 小节", "- a"]);
});

test("paste fails when headings would exceed level 6 or go under a list item", () => {
	const o = parse(["###### deep", "- item"]);
	assert.equal(pasteBlock(o, at(o, "deep"), "# x"), null);
	assert.equal(pasteBlock(o, at(o, "item"), "# x"), null);
});

test("paste of a list under the root is refused", () => {
	const o = parse(["# A"]);
	assert.equal(pasteBlock(o, o.root, "- x"), null);
});

test("plain text becomes one list item per non-empty line", () => {
	const o = parse(["# A"]);
	const res = pasteBlock(o, at(o, "A"), "first\n\n  second\r\nthird\n")!;
	assert.equal(res.text, "# A\n- first\n- second\n- third");
});

test("copy then paste after a sibling reproduces the subtree", () => {
	const o = parse(DOC);
	const md = copyBlock(o, at(o, "原理"))!;
	const res = pasteBlock(o, at(o, "扩容"), md, "after")!;
	assert.deepEqual(res.text.split("\n").slice(3, 11), [
		"- 原理",
		"  - 数组加链表",
		"  - 红黑树",
		"- 扩容",
		"- 原理",
		"  - 数组加链表",
		"  - 红黑树",
		"",
	]);
});

test("noteOf reads body text up to the first child and drops list indentation", () => {
	const o = parse(["# A", "", "intro", "", "## B", "- q", "  answer line 1", "  answer line 2", "- r"]);
	assert.equal(noteOf(o, at(o, "A")), "intro");
	assert.equal(noteOf(o, at(o, "q")), "answer line 1\nanswer line 2");
	assert.equal(noteOf(o, at(o, "r")), "");
	assert.equal(noteOf(o, o.root), "");
});

test("setNodeNote adds an indented note to a list item", () => {
	const o = parse(["# A", "- q", "- r"]);
	const res = setNodeNote(o, at(o, "q"), "line 1\n\nline 2");
	assert.equal(res.text, "# A\n- q\n  line 1\n\n  line 2\n- r");
	assert.equal(noteOf(parse(res.text.split("\n")), at(parse(res.text.split("\n")), "q")), "line 1\n\nline 2");
});

test("setNodeNote replaces an existing note and keeps surrounding blank lines", () => {
	const o = parse(["## A", "", "old", "", "### B"]);
	assert.equal(setNodeNote(o, at(o, "A"), "new text").text, "## A\n\nnew text\n\n### B");
});

test("setNodeNote with empty text clears the note but keeps the spacing after it", () => {
	const o = parse(["- q", "  old", "", "- r"]);
	assert.equal(setNodeNote(o, at(o, "q"), "  \n").text, "- q\n\n- r");
});

test("setNodeNote keeps a code fence inside a list note", () => {
	const o = parse(["- q", "- r"]);
	const res = setNodeNote(o, at(o, "q"), "```java\nint a = 1;\n```");
	assert.equal(res.text, "- q\n  ```java\n  int a = 1;\n  ```\n- r");
	const back = parse(res.text.split("\n"));
	assert.equal(back.nodes.length, 2);
	assert.equal(noteOf(back, at(back, "q")), "```java\nint a = 1;\n```");
});

test("noteHasNodes flags heading and list lines but not fenced ones", () => {
	assert.equal(noteHasNodes("plain\ntext"), false);
	assert.equal(noteHasNodes("- item"), true);
	assert.equal(noteHasNodes("# title"), true);
	assert.equal(noteHasNodes("```\n- inside fence\n```"), false);
});
