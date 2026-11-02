import { writeFileSync } from "node:fs";
import { layoutTree, type LItem } from "../src/layout.ts";
import { parseOutline, type OutlineNode } from "../src/outline.ts";

const SAMPLE = `# Learning Plan

## Languages
### English
- Vocabulary
  - Flashcards every morning
- Listening
  - Podcasts on the commute
### Spanish
- Basics
  - Greetings

## Projects
### Personal website
- Write the about page
- Set up RSS
### Reading
- "Deep Work" by Cal Newport
  - Plan the week in blocks

## Weekly review
- What went well?
  Finished the website outline.
- What to improve?
  - Sleep earlier
`;

const outline = parseOutline(SAMPLE, "Learning Plan");

const measure = (n: OutlineNode): { w: number; h: number } => {
	const len = Math.max(1, n.text.length);
	const w = Math.min(260, Math.max(44, len * 7 + 28));
	const h = n.kind === "root" ? 44 : n.depth === 1 ? 36 : 28;
	return { w, h };
};

const descCount = (n: OutlineNode): number => n.children.reduce((s, c) => s + 1 + descCount(c), 0);

const full = layoutTree(outline.root, () => false, measure, { hGap: 44, vGap: 10 });
const folded = layoutTree(outline.root, (n) => n.depth >= 3, measure, { hGap: 44, vGap: 10 });

const serialize = (items: LItem[]) =>
	items.map((it) => ({
		text: it.node.text,
		kind: it.node.kind,
		depth: it.node.depth,
		x: it.x,
		y: it.y,
		w: it.w,
		h: it.h,
		side: it.side,
		parent: it.parent?.node.text ?? null,
		folded: it.node.children.length > 0 && it.children.length === 0,
		count: descCount(it.node),
	}));

writeFileSync(
	new URL("./demo-layout.json", import.meta.url),
	JSON.stringify({ full: serialize(full), folded: serialize(folded) }, null, 2),
	"utf8",
);
console.log(`full=${full.length} folded=${folded.length}`);
