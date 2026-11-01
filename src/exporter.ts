import type { Outline, OutlineNode } from "./outline.ts";
import type { Bounds } from "./viewport.ts";

/** The active window's document on desktop; falls back to `document` on mobile. */
const g = globalThis as { activeDocument?: Document; document?: Document };
const doc: Document = g.activeDocument ?? g.document ?? ({} as Document);

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isClear = (c: string) => c === "transparent" || /,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
const px = (v: string) => parseFloat(v) || 0;

interface TextLine {
	text: string;
	x: number;
	y: number;
}

/** Visual lines of a text node, so the export wraps exactly where the screen does. */
function textLines(tn: Text, ox: number, oy: number, scale: number): TextLine[] {
	const range = doc.createRange();
	const lines: (TextLine & { top: number; h: number })[] = [];
	let cur: (typeof lines)[number] | null = null;
	let i = 0;
	for (const ch of tn.data) {
		range.setStart(tn, i);
		range.setEnd(tn, i + ch.length);
		i += ch.length;
		const r = range.getClientRects()[0];
		if (!r) {
			if (cur) cur.text += ch;
		} else if (!cur || Math.abs(r.top - cur.top) > r.height / 2) {
			cur = { text: ch, top: r.top, h: r.height, x: (r.left - ox) / scale, y: (r.top - oy) / scale };
			lines.push(cur);
		} else {
			cur.text += ch;
		}
	}
	return lines;
}

function nodeSvg(el: HTMLElement): string {
	const cs = getComputedStyle(el);
	const x = px(el.style.left);
	const y = px(el.style.top);
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	const box = el.getBoundingClientRect();
	const scale = w ? box.width / w : 1;
	const r = Math.min(px(cs.borderTopLeftRadius), h / 2);
	let out = "";

	if (!isClear(cs.backgroundColor))
		out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${esc(cs.backgroundColor)}"/>`;
	const bw = px(cs.borderBottomWidth);
	if (bw > 0 && !isClear(cs.borderBottomColor)) {
		if (isClear(cs.borderTopColor)) {
			const yy = y + h - bw / 2;
			out += `<line x1="${x}" y1="${yy}" x2="${x + w}" y2="${yy}" stroke="${esc(cs.borderBottomColor)}" stroke-width="${bw}"/>`;
		} else {
			out += `<rect x="${x + bw / 2}" y="${y + bw / 2}" width="${w - bw}" height="${h - bw}" rx="${r}" fill="none" stroke="${esc(cs.borderTopColor)}" stroke-width="${bw}"/>`;
		}
	}

	const origin = { x: box.left - x * scale, y: box.top - y * scale };
	const check = el.querySelector<HTMLElement>(".mt-check");
	if (check) {
		const c = getComputedStyle(check);
		const r = check.getBoundingClientRect();
		const cx = (r.left - origin.x) / scale;
		const cy = (r.top - origin.y) / scale;
		const s = r.width / scale;
		const done = el.classList.contains("is-done");
		const stroke = esc(c.borderTopColor);
		out += `<rect x="${cx + 0.75}" y="${cy + 0.75}" width="${s - 1.5}" height="${s - 1.5}" rx="4" fill="${done ? stroke : "none"}" stroke="${stroke}" stroke-width="1.5"/>`;
		if (done)
			out += `<path d="M ${cx + s * 0.25} ${cy + s * 0.52} L ${cx + s * 0.43} ${cy + s * 0.7} L ${cx + s * 0.75} ${cy + s * 0.3}" fill="none" stroke="${esc(getComputedStyle(el).getPropertyValue("--text-on-accent") || "#fff")}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
	}
	const tn = el.querySelector(".mt-text")?.firstChild;
	if (tn instanceof Text) {
		const attrs = `font-size="${px(cs.fontSize)}" font-weight="${esc(cs.fontWeight)}" font-family="${esc(cs.fontFamily)}" fill="${esc(cs.color)}"`;
		for (const l of textLines(tn, origin.x, origin.y, scale)) {
			out += `<text x="${l.x}" y="${l.y}" dominant-baseline="text-before-edge" xml:space="preserve" ${attrs}>${esc(l.text)}</text>`;
		}
	}
	return out;
}

/** Serialise the drawn map to a standalone SVG using the colours currently on screen. */
export function buildSvg(
	stage: HTMLElement,
	bounds: Bounds,
	background: string,
): { svg: string; w: number; h: number } {
	const w = Math.ceil(bounds.maxX - bounds.minX);
	const h = Math.ceil(bounds.maxY - bounds.minY);
	let body = "";
	for (const p of Array.from(stage.querySelectorAll<SVGPathElement>("path.mt-edge"))) {
		const cs = getComputedStyle(p);
		body += `<path d="${esc(p.getAttribute("d") ?? "")}" fill="none" stroke="${esc(cs.stroke)}" stroke-width="${px(cs.strokeWidth)}" opacity="${cs.opacity}"/>`;
	}
	for (const el of Array.from(stage.querySelectorAll<HTMLElement>(".mt-node"))) body += nodeSvg(el);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.minX} ${bounds.minY} ${w} ${h}">` +
		`<rect x="${bounds.minX}" y="${bounds.minY}" width="${w}" height="${h}" fill="${esc(background)}"/>${body}</svg>`;
	return { svg, w, h };
}

export async function svgToPng(svg: string, w: number, h: number): Promise<ArrayBuffer> {
	const scale = Math.min(2, 8192 / Math.max(w, h));
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = doc.createElement("canvas");
		canvas.width = Math.round(w * scale);
		canvas.height = Math.round(h * scale);
		canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
		if (!blob) throw new Error("canvas export failed");
		return await blob.arrayBuffer();
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Serialise the full outline to OPML for interchange with other outline and mind-map tools. */
export function outlineToOpml(outline: Outline): string {
	const walk = (node: OutlineNode): string => {
		if (node.kind === "root") return node.children.map(walk).join("");
		const note = node.note ? ` _note="${esc(node.note)}"` : "";
		return `<outline text="${esc(node.text)}"${note}>${node.children.map(walk).join("")}</outline>`;
	};
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<opml version="2.0">\n  <head><title>${esc(outline.root.text)}</title></head>\n  <body>${walk(outline.root)}</body>\n</opml>\n`
	);
}
