import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOutline, type Outline } from "../src/outline.ts";
import { isQuestion, openQuestion, questionOf, recallFolds } from "../src/recall.ts";

const parse = (lines: string[]): Outline => parseOutline(lines.join("\n"), "t");
const at = (o: Outline, text: string) => o.nodes.find((n) => n.text === text)!;

const DOC = [
	"# 面试",
	"## 集合",
	"- HashMap 原理",
	"  数组加链表",
	"  - 扩容",
	"    - 负载因子",
	"- ArrayList",
	"  动态数组",
	"- 空问题",
	"## JVM",
	"- 内存模型",
	"  - 堆",
];

test("only first-level list items with an answer are questions", () => {
	const o = parse(DOC);
	assert.equal(isQuestion(o, at(o, "HashMap 原理")), true);
	assert.equal(isQuestion(o, at(o, "ArrayList")), true);
	assert.equal(isQuestion(o, at(o, "空问题")), false);
	assert.equal(isQuestion(o, at(o, "扩容")), false);
	assert.equal(isQuestion(o, at(o, "集合")), false);
});

test("questionOf walks up from an answer node", () => {
	const o = parse(DOC);
	assert.equal(questionOf(o, at(o, "负载因子"))?.text, "HashMap 原理");
	assert.equal(questionOf(o, at(o, "JVM")), null);
});

test("selecting a question keeps its state, selecting inside it opens it", () => {
	const o = parse(DOC);
	const q = at(o, "HashMap 原理");
	assert.equal(openQuestion(o, q, null), null);
	assert.equal(openQuestion(o, q, q.key), q.key);
	assert.equal(openQuestion(o, at(o, "扩容"), null), q.key);
	assert.equal(openQuestion(o, at(o, "ArrayList"), q.key), null);
	assert.equal(openQuestion(o, at(o, "JVM"), q.key), null);
});

test("recallFolds folds every question with children except the open one", () => {
	const o = parse(DOC);
	const open = at(o, "内存模型").key;
	assert.deepEqual(
		recallFolds(o, open).sort(),
		[at(o, "HashMap 原理").key].sort(),
	);
	assert.deepEqual(recallFolds(o, null).sort(), [at(o, "HashMap 原理").key, at(o, "内存模型").key].sort());
});
