import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOutline } from "../src/outline.ts";
import { outlineToOpml } from "../src/exporter.ts";

test("outlineToOpml nests headings and list items and escapes text", () => {
	const o = parseOutline('# Root\n## Child\n- Item <b>&"\n', "t");
	const opml = outlineToOpml(o);
	assert.match(opml, /<opml version="2.0">/);
	assert.match(opml, /<outline text="Root">/);
	assert.match(opml, /<outline text="Child">/);
	assert.match(opml, /<outline text="Item &lt;b&gt;&amp;&quot;">/);
});

test("outlineToOpml carries notes as _note", () => {
	const o = parseOutline("# Root\nA note here\n", "t");
	const opml = outlineToOpml(o);
	assert.match(opml, /<outline text="Root" _note="A note here">/);
});
