import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOutline } from "../src/outline.ts";
import { findMatches, foldedAncestors } from "../src/search.ts";

const o = parseOutline("# Agent\n- Memory\n  - Vector Store\n- [Docs](https://example.com)\nbody mentions planner\n# Other\n", "doc");

test("matching ignores case and follows document order", () => {
	assert.deepEqual(findMatches(o.nodes, "MEM").map((n) => n.text), ["Memory"]);
	assert.deepEqual(findMatches(o.nodes, "o").map((n) => n.text), ["Memory", "Vector Store", "[Docs](https://example.com)", "Other"]);
});

test("link targets are not searched, notes are", () => {
	assert.equal(findMatches(o.nodes, "example").length, 0);
	assert.deepEqual(findMatches(o.nodes, "planner").map((n) => n.text), ["[Docs](https://example.com)"]);
});

test("a blank query matches nothing", () => {
	assert.equal(findMatches(o.nodes, "  ").length, 0);
});

test("lists the folded ancestors of a match", () => {
	const store = o.nodes.find((n) => n.text === "Vector Store")!;
	const memory = store.parent!;
	assert.deepEqual(foldedAncestors(store, new Set([memory.key, "x"])), [memory.key]);
});
