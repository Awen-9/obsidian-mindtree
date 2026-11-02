import {
	ItemView,
	MarkdownRenderer,
	Menu,
	Notice,
	Scope,
	TFile,
	normalizePath,
	setIcon,
	type TAbstractFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import {
	addChild,
	addSibling,
	cleanText,
	copyBlock,
	deleteNode,
	moveNode,
	moveSibling,
	pasteBlock,
	setNodeText,
	type EditResult,
} from "./edit.ts";
import { displayText, drawMap, type DrawResult } from "./draw.ts";
import { startDrag, type DropTarget } from "./drag.ts";
import { startInlineEdit } from "./editor.ts";
import { buildSvg, outlineToOpml, svgToPng } from "./exporter.ts";
import { History } from "./history.ts";
import { handleKey } from "./keys.ts";
import { firstLink } from "./links.ts";
import { navigate, type Dir } from "./nav.ts";
import { noteHasNodes, noteOf, setNodeNote } from "./note.ts";
import { findByKey, findByLine, parseOutline, type Outline, type OutlineNode } from "./outline.ts";
import { isQuestion, openQuestion, recallFolds } from "./recall.ts";
import { findMatches, foldedAncestors } from "./search.ts";
import { t } from "./i18n.ts";
import { THEMES } from "./themes.ts";
import { toggleTask } from "./task.ts";
import { activeHeading, filterHeadings, headingTree, tocEntries } from "./toc.ts";
import { buildToolbar } from "./toolbar.ts";
import { Viewport } from "./viewport.ts";
import type MindTreePlugin from "./main.ts";

export const VIEW_TYPE = "mindtree-view";

export class MindView extends ItemView {
	file: TFile | null = null;
	private text = "";
	private outline!: Outline;
	private history = new History();
	private collapsed = new Set<string>();
	private selectedKey = "";
	private pendingNew = false;
	private editing = false;
	private needsFit = true;
	private drawn: DrawResult | null = null;
	private hostEl!: HTMLElement;
	private tocEl!: HTMLElement;
	private tocList!: HTMLElement;
	private tocSearchInput!: HTMLInputElement;
	private tocClearBtn!: HTMLElement;
	private tocItems = new Map<string, HTMLElement>();
	private tocCollapsed = new Set<string>();
	private tocQuery = "";
	private stageEl!: HTMLElement;
	private viewport!: Viewport;
	private searchEl!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private searchCount!: HTMLElement;
	private matches: string[] = [];
	private matchAt = 0;
	private noteEl!: HTMLElement;
	private noteTitle!: HTMLElement;
	private noteBody!: HTMLElement;
	private noteSig = "";
	private noteEditing = false;
	private recall = false;
	private recallOpen: string | null = null;
	private savedCollapsed = new Set<string>();

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MindTreePlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? t("view.title");
	}

	getIcon(): string {
		return "network";
	}

	getState(): { file: string | null } {
		return { file: this.file?.path ?? null };
	}

	async setState(state: { file?: string } | null, result: ViewStateResult): Promise<void> {
		if (state?.file) await this.loadFile(state.file);
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.scope = new Scope(this.app.scope);
		const root = this.contentEl;
		root.empty();
		root.addClass("mt-view");
		this.buildBar(root.createDiv({ cls: "mt-toolbar" }));
		this.buildSearch(root);
		const body = root.createDiv({ cls: "mt-body" });
		this.tocEl = body.createDiv({ cls: "mt-toc" });
		this.tocEl.toggleClass("is-open", this.plugin.isTocOpen());
		this.tocEl.addEventListener("click", (e) => this.onTocClick(e));
		this.buildToc();
		const main = body.createDiv({ cls: "mt-main" });
		this.hostEl = main.createDiv({ cls: "mt-host" });
		this.hostEl.dataset.hintEmpty = t("hint.empty");
		this.hostEl.dataset.hintRecall = t("hint.recall");
		this.buildNote(main);
		this.hostEl.tabIndex = 0;
		this.stageEl = this.hostEl.createDiv({ cls: "mt-stage" });
		this.viewport = new Viewport(this.hostEl, this.stageEl);
		this.hostEl.addEventListener("keydown", (e) => this.onKey(e));
		this.hostEl.addEventListener("pointerdown", (e) => this.onPointer(e));
		this.hostEl.addEventListener("dblclick", (e) => this.onDblClick(e));
		this.registerEvent(this.app.vault.on("modify", (f) => void this.onModify(f)));

		const resize = new ResizeObserver(() => {
			if (!this.drawn || !this.hostEl.clientWidth) return;
			if (this.needsFit || !this.viewport.moved) {
				this.viewport.fit(this.drawn.bounds);
				this.needsFit = false;
			} else {
				this.viewport.keepCenter();
			}
		});
		resize.observe(this.hostEl);
		this.register(() => resize.disconnect());
		this.applyTheme(false);
		if (this.file) this.render();
	}

	private async loadFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this.file = file;
		this.recall = false;
		this.hostEl?.removeClass("is-recall");
		this.setText(await this.app.vault.read(file));
		this.collapsed = this.plugin.getCollapsed(file.path, this.outline);
		this.tocCollapsed = this.plugin.getTocCollapsed(file.path, this.outline);
		this.history.clear();
		this.selectedKey = "";
		this.needsFit = true;
		this.render();
	}

	private setText(text: string): void {
		this.text = text;
		this.outline = parseOutline(text, this.file?.basename ?? "");
	}

	private render(): void {
		if (!this.hostEl || !this.file) return;
		this.hostEl.toggleClass("is-empty", this.outline.root.children.length === 0);
		this.drawn = drawMap(this.stageEl, this.outline.root, this.collapsed, this.selectedKey);
		this.refreshMatches();
		this.renderToc();
		this.renderNote();
		if (this.needsFit && this.hostEl.clientWidth) {
			this.viewport.fit(this.drawn.bounds);
			this.needsFit = false;
		}
	}

	private async onModify(f: TAbstractFile): Promise<void> {
		const file = this.file;
		if (!file || f !== file || this.editing) return;
		const data = await this.app.vault.read(file);
		if (data === this.text) return;
		this.setText(data);
		this.fixSelection();
		this.recallSync();
		this.render();
	}

	private async writeText(next: string): Promise<boolean> {
		const file = this.file;
		if (!file) return false;
		let conflict = false;
		await this.app.vault.process(file, (data) => {
			if (data !== this.text) {
				conflict = true;
				return data;
			}
			this.setText(next);
			return next;
		});
		if (conflict) {
			this.history.clear();
			await this.onModify(file);
			return false;
		}
		return true;
	}

	private async apply(op: (o: Outline) => EditResult, merge = false): Promise<EditResult | null> {
		const before = this.text;
		const res = op(this.outline);
		if (res.text === before) return res;
		if (!(await this.writeText(res.text))) return null;
		if (!merge) this.history.push(before);
		return res;
	}

	private afterEdit(res: EditResult | null): void {
		const node = res && res.focusLine !== null ? findByLine(this.outline, res.focusLine) : null;
		if (node) this.selectedKey = node.key;
		this.fixSelection();
		this.render();
		this.ensureVisible();
		this.syncSource();
	}

	private async undoRedo(redo: boolean): Promise<void> {
		const target = redo ? this.history.redo(this.text) : this.history.undo(this.text);
		if (target === null) return;
		if (await this.writeText(target)) this.afterEdit({ text: target, focusLine: null });
	}

	private selected(): OutlineNode {
		return findByKey(this.outline, this.selectedKey) ?? this.outline.root;
	}

	/** Keep the selection visible: a folded ancestor stands in for its hidden descendants. */
	private fixSelection(): void {
		let target = this.selected();
		for (let p = target.parent; p; p = p.parent) if (this.collapsed.has(p.key)) target = p;
		this.selectedKey = target.key;
	}

	private select(key: string, sync = true): void {
		this.drawn?.els.get(this.selectedKey)?.classList.remove("is-selected");
		this.selectedKey = key;
		if (this.recallSync()) this.render();
		this.drawn?.els.get(key)?.classList.add("is-selected");
		if (this.revealInToc(this.selected())) this.renderToc();
		else this.markToc();
		this.renderNote();
		this.ensureVisible();
		if (sync) this.syncSource();
	}

	private syncSource(): void {
		const node = this.selected();
		if (this.file && node.kind !== "root") this.plugin.revealInSource(this.file, node.line, node.textStart);
	}

	/** Select the deepest node covering a source line, e.g. when the Markdown cursor moves. */
	selectLine(line: number): void {
		let best: OutlineNode | null = null;
		for (const n of this.outline.nodes) if (n.line <= line && line < n.endLine) best = n;
		if (!best) return;
		let shown = best;
		for (let p = best.parent; p; p = p.parent) if (this.collapsed.has(p.key)) shown = p;
		if (shown.key !== this.selectedKey) this.select(shown.key, false);
	}

	private ensureVisible(): void {
		const it = this.drawn?.items.find((i) => i.node.key === this.selectedKey);
		if (it) this.viewport.reveal({ x: it.x, y: it.y, w: it.w, h: it.h });
	}

	private persistCollapsed(): void {
		if (this.file && !this.recall) this.plugin.setCollapsed(this.file.path, [...this.collapsed]);
	}

	private remapKeys(oldKey: string, newKey: string): void {
		if (oldKey === newKey) return;
		for (const k of [...this.collapsed]) {
			if (k === oldKey || k.startsWith(`${oldKey}/`)) {
				this.collapsed.delete(k);
				this.collapsed.add(newKey + k.slice(oldKey.length));
			}
		}
		this.persistCollapsed();
	}

	private async addNode(kind: "child" | "sibling"): Promise<void> {
		const node = this.selected();
		if (kind === "child" || node.kind === "root") {
			this.collapsed.delete(node.key);
			this.persistCollapsed();
		}
		const res = await this.apply((o) => (kind === "child" ? addChild(o, node) : addSibling(o, node)));
		if (!res) return;
		this.pendingNew = true;
		this.afterEdit(res);
		this.beginEdit();
	}

	private beginEdit(): void {
		const node = this.selected();
		const el = this.drawn?.els.get(node.key);
		if (node.kind === "root" || !el || this.editing) return;
		this.editing = true;
		startInlineEdit(el, node.text, (text, wantChild) => void this.finishEdit(node, text, wantChild));
	}

	private async finishEdit(node: OutlineNode, text: string | null, wantChild: boolean): Promise<void> {
		this.editing = false;
		const isNew = this.pendingNew;
		this.pendingNew = false;
		const value = text === null ? "" : cleanText(text);

		if (isNew && !value) {
			// An empty new node is dropped by rolling back its creation.
			const before = this.history.discard();
			this.selectedKey = node.parent?.key ?? "";
			if (before !== null && (await this.writeText(before))) this.afterEdit(null);
			else this.render();
		} else if (value && value !== node.text) {
			const oldKey = node.key;
			const res = await this.apply((o) => setNodeText(o, node, value), isNew);
			const updated = res ? findByLine(this.outline, node.line) : null;
			if (updated) this.remapKeys(oldKey, updated.key);
			this.afterEdit(res);
		} else {
			this.render();
		}
		this.hostEl.focus({ preventScroll: true });
		if (wantChild && value) await this.addNode("child");
	}

	private async remove(): Promise<void> {
		const node = this.selected();
		if (node.kind === "root" || !node.parent) return;
		const siblings = node.parent.children;
		const i = siblings.indexOf(node);
		const fallback = [siblings[i + 1], siblings[i - 1], node.parent]
			.filter((n): n is OutlineNode => !!n)
			.map((n) => n.key);
		const res = await this.apply((o) => deleteNode(o, node));
		if (!res) return;
		this.selectedKey = fallback.find((k) => findByKey(this.outline, k)) ?? "";
		this.afterEdit(res);
	}

	private async copyNode(cut: boolean): Promise<void> {
		const md = copyBlock(this.outline, this.selected());
		if (md === null) return;
		try {
			await navigator.clipboard.writeText(md);
		} catch {
			new Notice(t("notice.clipboard"));
			return;
		}
		if (cut) await this.remove();
		else new Notice(t("notice.copied"));
	}

	private async pasteNode(): Promise<void> {
		let text: string;
		try {
			text = await navigator.clipboard.readText();
		} catch {
			new Notice(t("notice.clipboard"));
			return;
		}
		const target = this.selected();
		const plan = pasteBlock(this.outline, target, text);
		if (!plan) {
			new Notice(t("notice.pasteDenied"));
			return;
		}
		this.collapsed.delete(target.key);
		this.persistCollapsed();
		this.afterEdit(await this.apply(() => plan));
	}

	private async move(dir: -1 | 1): Promise<void> {
		const node = this.selected();
		this.afterEdit(await this.apply((o) => moveSibling(o, node, dir)));
	}

	private toggleFold(key: string): void {
		const node = findByKey(this.outline, key);
		if (!node) return;
		if (this.recall && isQuestion(this.outline, node)) {
			this.recallOpen = this.recallOpen === key ? null : key;
			this.applyRecallFolds();
			this.render();
			return;
		}
		if (!node.children.length) return;
		if (!this.collapsed.delete(key)) this.collapsed.add(key);
		this.fixSelection();
		this.persistCollapsed();
		this.render();
	}

	/** Fold every question except the open one. Returns whether anything changed. */
	private applyRecallFolds(): boolean {
		const next = new Set(recallFolds(this.outline, this.recallOpen));
		let changed = false;
		for (const n of this.outline.nodes) {
			if (!n.children.length || !isQuestion(this.outline, n)) continue;
			if (next.has(n.key) === this.collapsed.has(n.key)) continue;
			if (next.has(n.key)) this.collapsed.add(n.key);
			else this.collapsed.delete(n.key);
			changed = true;
		}
		return changed;
	}

	/** After the selection moved, show only the answer that belongs to it. Returns whether the map needs redrawing. */
	private recallSync(): boolean {
		if (!this.recall) return false;
		this.recallOpen = openQuestion(this.outline, this.selected(), this.recallOpen);
		return this.applyRecallFolds();
	}

	toggleRecall(): void {
		if (this.editing || !this.file) return;
		this.recall = !this.recall;
		this.hostEl.toggleClass("is-recall", this.recall);
		if (this.recall) {
			this.savedCollapsed = new Set(this.collapsed);
			this.recallOpen = null;
			this.applyRecallFolds();
		} else {
			this.collapsed = this.savedCollapsed;
		}
		this.fixSelection();
		this.needsFit = true;
		this.noteSig = "";
		this.render();
	}

	private blocked(): boolean {
		if (this.recall) new Notice(t("notice.recallBlocked"));
		return this.recall;
	}

	/** Show `n` levels below the root; every deeper branch is folded. */
	private setLevel(n: number): void {
		if (this.blocked()) return;
		for (const node of [this.outline.root, ...this.outline.nodes]) {
			if (!node.children.length) continue;
			if (node.depth >= n) this.collapsed.add(node.key);
			else this.collapsed.delete(node.key);
		}
		this.fixSelection();
		this.persistCollapsed();
		this.render();
	}

	private go(dir: Dir): void {
		const items = this.drawn?.items;
		if (!items) return;
		const sel = items.find((i) => i.node.key === this.selectedKey) ?? items[0];
		const r = navigate(items, sel, dir);
		if (r.expand) {
			if (this.recall && isQuestion(this.outline, sel.node)) {
				this.recallOpen = sel.node.key;
				this.applyRecallFolds();
			} else {
				this.collapsed.delete(sel.node.key);
				this.persistCollapsed();
			}
			this.render();
			this.go(dir);
		} else if (r.item) {
			this.select(r.item.node.key);
		}
	}

	private onKey(e: KeyboardEvent): void {
		if (this.editing || e.isComposing) return;
		if (this.recall && e.key === "Escape") {
			e.preventDefault();
			this.toggleRecall();
			return;
		}
		const edit = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
			if (!this.blocked()) fn(...a);
		};
		const handled = handleKey(e, {
			undoRedo: edit((redo) => void this.undoRedo(redo)),
			move: edit((dir) => void this.move(dir)),
			go: (dir) => this.go(dir),
			addNode: edit((kind) => void this.addNode(kind)),
			remove: edit(() => void this.remove()),
			edit: edit(() => this.beginEdit()),
			fold: () => this.toggleFold(this.selectedKey),
			level: (n) => this.setLevel(n),
			search: () => this.openSearch(),
			copy: () => void this.copyNode(false),
			cut: edit(() => void this.copyNode(true)),
			paste: edit(() => void this.pasteNode()),
		});
		if (handled) e.preventDefault();
	}

	private onPointer(e: PointerEvent): void {
		if (this.editing || e.button !== 0) return;
		const target = e.target as HTMLElement;
		const toggle = target.closest<HTMLElement>(".mt-toggle");
		if (toggle) {
			e.preventDefault();
			this.toggleFold(toggle.dataset.key ?? "");
			return;
		}
		const nodeEl = target.closest<HTMLElement>(".mt-node");
		if (nodeEl) {
			const key = nodeEl.dataset.key ?? "";
			this.select(key);
			const node = findByKey(this.outline, key);
			if (node && target.closest(".mt-check")) {
				e.preventDefault();
				if (!this.blocked()) void this.toggleTaskNode(node);
			} else if (node && (e.metaKey || e.ctrlKey) && this.openLink(node)) {
				e.preventDefault();
			} else if (node && node.kind !== "root" && !this.recall) {
				this.beginDrag(e, node);
			}
		}
		this.hostEl.focus({ preventScroll: true });
	}

	private openLink(node: OutlineNode): boolean {
		const link = firstLink(node.text);
		if (!link || !this.file) return false;
		if (link.external) window.open(link.target, "_blank", "noopener");
		else void this.app.workspace.openLinkText(link.target, this.file.path, true);
		return true;
	}

	private async toggleTaskNode(node: OutlineNode): Promise<void> {
		const oldKey = node.key;
		const res = await this.apply((o) => toggleTask(o, node));
		const updated = res && res.focusLine !== null ? findByLine(this.outline, res.focusLine) : null;
		if (updated) this.remapKeys(oldKey, updated.key);
		this.afterEdit(res);
	}

	private beginDrag(e: PointerEvent, node: OutlineNode): void {
		startDrag(e, {
			host: this.hostEl,
			node,
			label: displayText(node.text),
			items: () => this.drawn?.items ?? [],
			elOf: (key) => this.drawn?.els.get(key),
			toStage: (x, y) => this.viewport.toStage(x, y),
			isValid: (t) => moveNode(this.outline, node, t.node, t.pos).text !== this.text,
			onDrop: (t) => void this.dropNode(node, t),
		});
	}

	private async dropNode(node: OutlineNode, t: DropTarget): Promise<void> {
		const oldKey = node.key;
		if (t.pos === "child") {
			this.collapsed.delete(t.node.key);
			this.persistCollapsed();
		}
		const res = await this.apply((o) => moveNode(o, node, t.node, t.pos));
		const moved = res && res.focusLine !== null ? findByLine(this.outline, res.focusLine) : null;
		if (moved) this.remapKeys(oldKey, moved.key);
		this.afterEdit(res);
	}

	private onDblClick(e: MouseEvent): void {
		const nodeEl = (e.target as HTMLElement).closest<HTMLElement>(".mt-node");
		if (!nodeEl || this.editing) return;
		this.select(nodeEl.dataset.key ?? "");
		if (!this.blocked()) this.beginEdit();
	}

	private buildBar(bar: HTMLElement): void {
		const act = (fn: () => unknown) => () => {
			if (!this.editing && !this.blocked()) void fn();
		};
		buildToolbar(bar, [
			[
				{ icon: "undo-2", label: t("tb.undo"), run: act(() => this.undoRedo(false)) },
				{ icon: "redo-2", label: t("tb.redo"), run: act(() => this.undoRedo(true)) },
			],
			[
				{ icon: "corner-down-right", label: t("tb.addChild"), run: act(() => this.addNode("child")) },
				{ icon: "plus", label: t("tb.addSibling"), run: act(() => this.addNode("sibling")) },
				{ icon: "pencil", label: t("tb.edit"), run: act(() => this.beginEdit()) },
				{ icon: "trash-2", label: t("tb.delete"), run: act(() => this.remove()) },
			],
			[
				{ icon: "chevrons-up-down", label: t("tb.expandAll"), run: act(() => this.setLevel(Infinity)) },
				{ icon: "chevrons-down-up", label: t("tb.collapse"), run: act(() => this.setLevel(1)) },
				{ icon: "search", label: t("tb.search"), run: () => this.openSearch() },
				{ icon: "list", label: t("tb.toc"), run: () => this.toggleToc() },
				{ icon: "sticky-note", label: t("tb.notes"), run: () => this.toggleNote() },
				{ icon: "eye-off", label: t("tb.recall"), run: () => this.toggleRecall() },
			],
			[
				{ icon: "zoom-out", label: t("tb.zoomOut"), run: () => this.viewport.zoomCenter(1 / 1.2) },
				{ icon: "zoom-in", label: t("tb.zoomIn"), run: () => this.viewport.zoomCenter(1.2) },
				{ icon: "maximize", label: t("tb.fit"), run: () => this.fitToView() },
			],
			[
				{ icon: "palette", label: t("tb.theme"), run: (e) => this.showThemeMenu(e) },
				{ icon: "download", label: t("tb.export"), run: (e) => this.showExportMenu(e) },
				{ icon: "panel-right", label: t("tb.source"), run: () => this.openSourceBeside() },
				{ icon: "file-text", label: t("tb.markdown"), run: () => this.openMarkdown() },
			],
		]);
	}

	private buildSearch(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "mt-searchbar" });
		this.searchEl = bar;
		const input = bar.createEl("input", { type: "text", attr: { placeholder: t("search.placeholder") } });
		this.searchInput = input;
		this.searchCount = bar.createSpan({ cls: "mt-search-count" });
		const btn = (icon: string, label: string, run: () => void) => {
			const b = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", run);
		};
		btn("chevron-up", t("search.prev"), () => this.gotoMatch(this.matchAt - 1));
		btn("chevron-down", t("search.next"), () => this.gotoMatch(this.matchAt + 1));
		btn("x", t("search.close"), () => this.closeSearch());

		const search = () => {
			this.matchAt = 0;
			this.refreshMatches();
			this.gotoMatch(0);
		};
		input.addEventListener("input", (e) => {
			if (e instanceof InputEvent && !e.isComposing) search();
		});
		input.addEventListener("compositionend", search);
		input.addEventListener("keydown", (e) => {
			if (e.isComposing) return;
			if (e.key === "Enter") {
				e.preventDefault();
				this.gotoMatch(this.matchAt + (e.shiftKey ? -1 : 1));
			} else if (e.key === "Escape") {
				e.preventDefault();
				this.closeSearch();
			}
		});
	}

	openSearch(): void {
		this.searchEl.addClass("is-open");
		this.searchInput.focus();
		this.searchInput.select();
		this.refreshMatches();
	}

	private closeSearch(): void {
		this.searchEl.removeClass("is-open");
		this.refreshMatches();
		this.hostEl.focus({ preventScroll: true });
	}

	/** Recompute matches against the current outline and repaint the highlights. */
	private refreshMatches(): void {
		if (!this.searchEl) return;
		const query = this.searchEl.hasClass("is-open") ? this.searchInput.value : "";
		this.matches = findMatches(this.outline?.nodes ?? [], query).map((n) => n.key);
		this.matchAt = Math.min(this.matchAt, Math.max(0, this.matches.length - 1));
		const found = new Set(this.matches);
		for (const [key, el] of this.drawn?.els ?? []) {
			el.toggleClass("is-match", found.has(key));
			el.toggleClass("is-current-match", key === this.matches[this.matchAt]);
		}
		this.searchCount.setText(!query.trim() ? "" : this.matches.length ? `${this.matchAt + 1}/${this.matches.length}` : t("search.none"));
	}

	private gotoMatch(i: number): void {
		const n = this.matches.length;
		if (!n) return;
		this.matchAt = ((i % n) + n) % n;
		const node = findByKey(this.outline, this.matches[this.matchAt]);
		if (!node) return;
		this.showNode(node);
		this.ensureVisible();
	}

	/** Select a node, unfolding whatever hides it. */
	private showNode(node: OutlineNode): void {
		const folded = foldedAncestors(node, this.collapsed);
		for (const k of folded) this.collapsed.delete(k);
		if (folded.length) this.persistCollapsed();
		this.selectedKey = node.key;
		this.recallSync();
		this.revealInToc(node);
		this.render();
		this.syncSource();
	}

	toggleToc(): void {
		const open = !this.tocEl.hasClass("is-open");
		this.tocEl.toggleClass("is-open", open);
		this.plugin.setTocOpen(open);
		this.renderToc();
	}

	/** Build the fixed search header and the scrollable list that holds the entries. */
	private buildToc(): void {
		const head = this.tocEl.createDiv({ cls: "mt-toc-head" });
		this.tocSearchInput = head.createEl("input", {
			type: "text",
			attr: { placeholder: t("toc.searchPlaceholder") },
		});
		const btn = (icon: string, label: string, run: () => void) => {
			const b = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", run);
		};
		btn("chevrons-up-down", t("toc.expandAll"), () => this.expandTocAll());
		btn("chevrons-down-up", t("toc.collapseAll"), () => this.collapseTocAll());
		this.tocClearBtn = head.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": t("toc.clear") },
		});
		setIcon(this.tocClearBtn, "x");
		this.tocClearBtn.hide();
		this.tocClearBtn.addEventListener("click", () => {
			this.tocSearchInput.value = "";
			this.applyTocQuery();
			this.tocSearchInput.focus();
		});
		this.tocSearchInput.addEventListener("input", (e) => {
			if (e instanceof InputEvent && !e.isComposing) this.applyTocQuery();
		});
		this.tocSearchInput.addEventListener("compositionend", () => this.applyTocQuery());
		this.tocSearchInput.addEventListener("keydown", (e) => {
			if (e.isComposing) return;
			if (e.key !== "Escape") return;
			e.preventDefault();
			this.tocSearchInput.value = "";
			this.applyTocQuery();
			this.hostEl.focus({ preventScroll: true });
		});
		this.tocList = this.tocEl.createDiv({ cls: "mt-toc-list" });
	}

	private persistTocCollapsed(): void {
		if (this.file && !this.recall) this.plugin.setTocCollapsed(this.file.path, [...this.tocCollapsed]);
	}

	private expandTocAll(): void {
		this.tocCollapsed.clear();
		this.persistTocCollapsed();
		this.renderToc();
	}

	private collapseTocAll(): void {
		const tree = headingTree(tocEntries(this.outline?.nodes ?? []));
		for (const [n, kids] of tree.children) if (kids.length) this.tocCollapsed.add(n.key);
		this.persistTocCollapsed();
		this.renderToc();
	}

	/** Unfold the collapsed TOC branches that hide `node`'s heading; returns true when the TOC changed. */
	private revealInToc(node: OutlineNode): boolean {
		const active = activeHeading(node);
		if (!active) return false;
		let changed = false;
		for (let p: OutlineNode | null = active.parent; p; p = p.parent) {
			if (p.kind === "heading" && this.tocCollapsed.delete(p.key)) changed = true;
		}
		if (changed) this.persistTocCollapsed();
		return changed;
	}

	private applyTocQuery(): void {
		this.tocQuery = this.tocSearchInput.value.trim();
		if (this.tocQuery) this.tocClearBtn.show();
		else this.tocClearBtn.hide();
		this.renderToc();
	}

	private renderToc(): void {
		if (!this.tocEl?.hasClass("is-open") || !this.tocList) return;
		this.tocList.empty();
		this.tocItems.clear();
		const headings = tocEntries(this.outline?.nodes ?? []);
		if (!headings.length) {
			this.tocList.createDiv({ cls: "mt-toc-empty", text: t("toc.empty") });
			return;
		}
		const filter = filterHeadings(headings, this.tocQuery);
		const tree = headingTree(headings);

		const renderLevel = (nodes: OutlineNode[]): void => {
			for (const n of nodes) {
				const kids = tree.children.get(n) ?? [];
				const label = displayText(n.text);
				const item = this.tocList.createDiv({ cls: "mt-toc-item" });
				item.dataset.key = n.key;
				item.style.paddingLeft = `${8 + (n.depth - 1) * 14}px`;
				const caret = item.createSpan({ cls: "mt-toc-caret" });
				if (kids.length) {
					const folded = !filter && this.tocCollapsed.has(n.key);
					caret.dataset.key = n.key;
					caret.textContent = folded ? "▸" : "▾";
				}
				item.createSpan({ cls: "mt-toc-label", text: label, attr: { title: label } });
				if (filter && !filter.matched.has(n)) item.toggleClass("is-dimmed", true);
				this.tocItems.set(n.key, item);

				const folded = !filter && this.tocCollapsed.has(n.key);
				if (kids.length && !folded) {
					const shown = filter ? kids.filter((c) => filter.visible.has(c)) : kids;
					renderLevel(shown);
				}
			}
		};

		const roots = filter ? tree.roots.filter((r) => filter.visible.has(r)) : tree.roots;
		renderLevel(roots);
		if (!this.tocItems.size && filter) {
			this.tocList.createDiv({ cls: "mt-toc-empty", text: t("toc.noMatch") });
			return;
		}
		this.markToc();
	}

	/** Highlight the chapter that holds the selected node. */
	private markToc(): void {
		if (!this.tocItems.size) return;
		const active = activeHeading(this.selected())?.key;
		for (const [key, el] of this.tocItems) el.toggleClass("is-active", key === active);
		this.tocItems.get(active ?? "")?.scrollIntoView({ block: "nearest" });
	}

	private onTocClick(e: MouseEvent): void {
		const caret = (e.target as HTMLElement).closest<HTMLElement>(".mt-toc-caret");
		const caretKey = caret?.dataset.key;
		if (caretKey !== undefined && !this.tocQuery) {
			if (this.tocCollapsed.has(caretKey)) this.tocCollapsed.delete(caretKey);
			else this.tocCollapsed.add(caretKey);
			this.persistTocCollapsed();
			this.renderToc();
			return;
		}
		const key = (e.target as HTMLElement).closest<HTMLElement>(".mt-toc-item")?.dataset.key;
		const node = key ? findByKey(this.outline, key) : null;
		if (!node || this.editing) return;
		this.showNode(node);
		const it = this.drawn?.items.find((i) => i.node.key === node.key);
		if (it) this.viewport.center({ x: it.x, y: it.y, w: it.w, h: it.h });
		this.hostEl.focus({ preventScroll: true });
	}

	private buildNote(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "mt-note" });
		this.noteEl = panel;
		panel.toggleClass("is-open", this.plugin.isNoteOpen());
		const head = panel.createDiv({ cls: "mt-note-head" });
		this.noteTitle = head.createSpan({ cls: "mt-note-title" });
		const btn = (icon: string, label: string, run: () => void) => {
			const b = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", run);
		};
		btn("pencil", t("note.edit"), () => this.editNote());
		btn("x", t("note.close"), () => this.toggleNote());
		this.noteBody = panel.createDiv({ cls: "mt-note-body" });
		this.noteBody.addEventListener("dblclick", () => this.editNote());
		this.noteBody.addEventListener("click", (e) => {
			const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
			if (!link || !this.file) return;
			e.preventDefault();
			void this.app.workspace.openLinkText(link.dataset.href ?? "", this.file.path, true);
		});
	}

	toggleNote(): void {
		if (this.noteEditing) return;
		const open = !this.noteEl.hasClass("is-open");
		this.noteEl.toggleClass("is-open", open);
		this.plugin.setNoteOpen(open);
		this.noteSig = "";
		this.renderNote();
	}

	/** Show the selected node's note, rendered as Markdown. */
	private renderNote(): void {
		if (!this.noteEl?.hasClass("is-open") || this.noteEditing || !this.file) return;
		const node = this.selected();
		const text = noteOf(this.outline, node);
		const hidden = text !== "" && this.recall && isQuestion(this.outline, node) && this.recallOpen !== node.key;
		const sig = `${node.key}\0${hidden}\0${text}`;
		if (sig === this.noteSig) return;
		this.noteSig = sig;
		this.noteTitle.setText(node.kind === "root" ? t("note.title") : t("note.titleFor", { name: displayText(node.text) }));
		if (hidden) {
			this.noteBody.empty();
			this.noteBody.createDiv({ cls: "mt-note-empty", text: t("note.hidden") });
			return;
		}
		if (!text) {
			this.noteBody.empty();
			this.noteBody.createDiv({
				cls: "mt-note-empty",
				text: node.kind === "root" ? t("note.rootEmpty") : t("note.empty"),
			});
			return;
		}
		const holder = createDiv({ cls: "markdown-rendered" });
		void MarkdownRenderer.render(this.app, text, holder, this.file.path, this).then(() => {
			if (sig === this.noteSig) this.noteBody.replaceChildren(holder);
		});
	}

	/** Edit the selected node's note in a text box; Cmd/Ctrl+Enter or leaving the box saves, Esc discards. */
	editNote(): void {
		const key = this.selectedKey;
		const node = this.selected();
		if (node.kind === "root" || this.editing || this.blocked()) return;
		if (!this.noteEl.hasClass("is-open")) this.toggleNote();
		this.editing = true;
		this.noteEditing = true;
		const original = noteOf(this.outline, node);
		this.noteTitle.setText(t("note.titleFor", { name: displayText(node.text) }));
		this.noteBody.empty();
		const input = this.noteBody.createEl("textarea", {
			cls: "mt-note-input",
			attr: { placeholder: t("note.placeholder") },
		});
		input.value = original;

		let done = false;
		const hotkey = this.scope?.register(["Mod"], "Enter", () => {
			finish(true, true);
			return false;
		});
		const finish = (save: boolean, explicit: boolean) => {
			if (done) return;
			const text = input.value;
			if (save && text !== original && noteHasNodes(text)) {
				new Notice(t("note.hasNodes"));
				if (explicit) return;
				save = false;
			}
			done = true;
			if (hotkey) this.scope?.unregister(hotkey);
			this.editing = false;
			this.noteEditing = false;
			this.noteSig = "";
			void this.saveNote(key, save && text !== original ? text : null);
		};
		input.addEventListener("keydown", (e) => {
			if (e.isComposing) return;
			if (e.key !== "Escape") return;
			e.preventDefault();
			finish(false, true);
		});
		input.addEventListener("blur", () => finish(true, false));
		input.focus();
	}

	private async saveNote(key: string, text: string | null): Promise<void> {
		if (text !== null && findByKey(this.outline, key)) {
			this.afterEdit(await this.apply((o) => setNodeNote(o, findByKey(o, key)!, text)));
		} else {
			this.render();
		}
		this.hostEl.focus({ preventScroll: true });
	}

	applyTheme(redraw = true): void {
		this.contentEl.dataset.mtTheme = this.plugin.getTheme();
		if (redraw && this.drawn) this.render();
	}

	private showThemeMenu(e: MouseEvent): void {
		const menu = new Menu();
		for (const theme of THEMES) {
			menu.addItem((item) =>
				item
					.setTitle(t(theme.label))
					.setChecked(this.plugin.getTheme() === theme.id)
					.onClick(() => this.plugin.setTheme(theme.id)),
			);
		}
		menu.showAtMouseEvent(e);
	}

	private showExportMenu(e: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t("export.png")).onClick(() => void this.exportImage("png")));
		menu.addItem((item) => item.setTitle(t("export.svg")).onClick(() => void this.exportImage("svg")));
		menu.addItem((item) => item.setTitle(t("export.opml")).onClick(() => void this.exportOpml()));
		menu.showAtMouseEvent(e);
	}

	/** Write the full outline as OPML next to the note. */
	async exportOpml(): Promise<void> {
		const file = this.file;
		if (!file) return;
		try {
			const opml = outlineToOpml(this.outline);
			const dir = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
			const path = normalizePath(`${dir}${file.basename}.mindmap.opml`);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await this.app.vault.modify(existing, opml);
			else await this.app.vault.create(path, opml);
			new Notice(t("export.done", { path }));
		} catch (err) {
			new Notice(t("export.fail", { error: err instanceof Error ? err.message : String(err) }));
		}
	}

	/** Write the map as it is currently drawn (folds included) next to the note. */
	async exportImage(kind: "png" | "svg"): Promise<void> {
		const file = this.file;
		if (!file || !this.drawn) return;
		try {
			const probe = this.contentEl.createDiv();
			probe.setCssStyles({ background: "var(--background-primary)" });
			const background = getComputedStyle(probe).backgroundColor;
			probe.remove();
			const { svg, w, h } = buildSvg(this.stageEl, this.drawn.bounds, background);
			const dir = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
			const path = normalizePath(`${dir}${file.basename}.mindmap.${kind}`);
			const existing = this.app.vault.getAbstractFileByPath(path);
			const target = existing instanceof TFile ? existing : null;
			if (kind === "svg") {
				if (target) await this.app.vault.modify(target, svg);
				else await this.app.vault.create(path, svg);
			} else {
				const png = await svgToPng(svg, w, h);
				if (target) await this.app.vault.modifyBinary(target, png);
				else await this.app.vault.createBinary(path, png);
			}
			new Notice(t("export.done", { path }));
		} catch (err) {
			new Notice(t("export.fail", { error: err instanceof Error ? err.message : String(err) }));
		}
	}

	private openSourceBeside(): void {
		if (this.file) void this.plugin.openSourceBeside(this.file);
	}

	private fitToView(): void {
		if (this.drawn) this.viewport.fit(this.drawn.bounds);
	}

	openMarkdown(): void {
		if (this.file) void this.leaf.setViewState({ type: "markdown", state: { file: this.file.path }, active: true });
	}
}
