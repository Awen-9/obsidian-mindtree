/**
 * Edit a node's text in place. `onDone` receives the final text, or null when the
 * edit was cancelled, and which node the key that ended it asks for next:
 * Tab a child, Enter a sibling.
 */
export function startInlineEdit(
	nodeEl: HTMLElement,
	raw: string,
	onDone: (text: string | null, next: "child" | "sibling" | null) => void,
): void {
	const textEl = nodeEl.querySelector<HTMLElement>(".mt-text");
	if (!textEl) return;
	const doc = nodeEl.ownerDocument;
	const win = doc.defaultView ?? window;
	textEl.textContent = raw;
	textEl.contentEditable = "true";
	nodeEl.classList.add("is-editing");

	let done = false;
	const finish = (save: boolean, next: "child" | "sibling" | null) => {
		if (done) return;
		done = true;
		textEl.contentEditable = "false";
		nodeEl.classList.remove("is-editing");
		onDone(save ? (textEl.textContent ?? "") : null, next);
	};

	textEl.addEventListener("keydown", (e) => {
		if (e.isComposing) return;
		if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
		// The map's own key handler would otherwise see this key once editing has ended.
		e.preventDefault();
		e.stopPropagation();
		if (e.key === "Enter") finish(true, "sibling");
		else if (e.key === "Escape") finish(false, null);
		else finish(true, "child");
	});
	textEl.addEventListener("blur", () => finish(true, null));
	textEl.addEventListener("paste", (e) => {
		e.preventDefault();
		const plain = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s*[\r\n]+\s*/g, " ");
		const caret = win.getSelection();
		if (!caret?.rangeCount) return;
		const at = caret.getRangeAt(0);
		at.deleteContents();
		const inserted = doc.createTextNode(plain);
		at.insertNode(inserted);
		at.setStartAfter(inserted);
		at.collapse(true);
		caret.removeAllRanges();
		caret.addRange(at);
	});

	textEl.focus();
	const range = doc.createRange();
	range.selectNodeContents(textEl);
	const sel = win.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}
