export interface NodeLink {
	external: boolean;
	target: string;
}

/** First link in a node's text: `[[note#heading|alias]]`, `[label](https://...)` or `[label](note.md)`. Embeds are skipped. */
export function firstLink(text: string): NodeLink | null {
	const re = /(!?)\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|(!?)\[[^\]]*\]\((<[^>]+>|[^)\s]+)[^)]*\)/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (m[1] || m[3]) continue;
		if (m[2]) return { external: false, target: m[2].trim() };
		const url = m[4].replace(/^<|>$/g, "");
		if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { external: true, target: url };
		try {
			return { external: false, target: decodeURI(url) };
		} catch {
			return { external: false, target: url };
		}
	}
	return null;
}
