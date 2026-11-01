/**
 * Edit a node's text in place. `onDone` receives the final text, or null when the
 * edit was cancelled, and whether Tab asked for a new child afterwards.
 */
export function startInlineEdit(
	nodeEl: HTMLElement,
	raw: string,
	onDone: (text: string | null, addChild: boolean) => void,
): void {
	const textEl = nodeEl.querySelector<HTMLElement>(".mt-text");
	if (!textEl) return;
	const doc = nodeEl.ownerDocument;
	const win = doc.defaultView ?? window;
	textEl.textContent = raw;
	textEl.contentEditable = "true";
	nodeEl.classList.add("is-editing");

	let done = false;
	const finish = (save: boolean, addChild: boolean) => {
		if (done) return;
		done = true;
		textEl.contentEditable = "false";
		nodeEl.classList.remove("is-editing");
		onDone(save ? (textEl.textContent ?? "") : null, addChild);
	};

	textEl.addEventListener("keydown", (e) => {
		if (e.isComposing || e.keyCode === 229) return;
		if (e.key === "Enter") {
			e.preventDefault();
			finish(true, false);
		} else if (e.key === "Escape") {
			e.preventDefault();
			finish(false, false);
		} else if (e.key === "Tab") {
			e.preventDefault();
			finish(true, true);
		}
	});
	textEl.addEventListener("blur", () => finish(true, false));
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
