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
	deleteNodes,
	dropRefusal,
	moveNodes,
	moveSibling,
	pasteBlock,
	setNodeText,
	topmost,
	type EditResult,
} from "./edit.ts";
import { displayText, drawMap, type DrawResult } from "./draw.ts";
import { startDrag, type DropTarget } from "./drag.ts";
import { startInlineEdit } from "./editor.ts";
import { buildSvg, outlineToOpml, svgToPng } from "./exporter.ts";
import { History } from "./history.ts";
import { handleKey } from "./keys.ts";
import { firstLink } from "./links.ts";
import { startMarquee } from "./marquee.ts";
import { navigate, type Dir } from "./nav.ts";
import { noteHasNodes, noteOf, setNodeNote } from "./note.ts";
import { findByKey, findByLine, parseOutline, type Outline, type OutlineNode } from "./outline.ts";
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
	/** Extra nodes picked with Shift+click or a Shift+drag rectangle; Delete and drag act on all of them. */
	private picked = new Set<string>();
	/** Touch-friendly multi-select: taps add or remove nodes and a drag on empty space draws a rectangle. */
	private pickMode = false;
	private pickBtn: HTMLElement | null = null;
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
		this.hostEl.dataset.hintPick = t("hint.pick");
		this.buildNote(main);
		this.hostEl.tabIndex = 0;
		this.stageEl = this.hostEl.createDiv({ cls: "mt-stage" });
		this.viewport = new Viewport(this.hostEl, this.stageEl, (e) => this.boxSelects(e));
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
		this.setText(await this.app.vault.read(file));
		this.collapsed = this.plugin.getCollapsed(file.path, this.outline);
		this.tocCollapsed = this.plugin.getTocCollapsed(file.path, this.outline);
		this.history.clear();
		this.selectedKey = "";
		this.picked.clear();
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
		for (const k of this.picked) this.drawn.els.get(k)?.addClass("is-picked");
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
			// Old snapshots would silently undo the outside change, so they go.
			this.history.clear();
			await this.onModify(file);
			new Notice(t("notice.conflict"));
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
		for (const k of [...this.picked]) {
			const n = findByKey(this.outline, k);
			if (!n || k === target.key || foldedAncestors(n, this.collapsed).length) this.picked.delete(k);
		}
	}

	/** The primary node plus the picked ones. */
	private selection(): OutlineNode[] {
		const picked = [...this.picked].map((k) => findByKey(this.outline, k));
		return [this.selected(), ...picked.filter((n): n is OutlineNode => !!n)];
	}

	private markSelection(): void {
		if (!this.drawn) return;
		for (const [k, el] of this.drawn.els) {
			el.toggleClass("is-selected", k === this.selectedKey);
			el.toggleClass("is-picked", this.picked.has(k));
		}
	}

	/** With `keepPicked` the previous primary node joins the picked ones instead of being dropped. */
	private select(key: string, sync = true, keepPicked = false): void {
		if (!keepPicked) this.picked.clear();
		else if (key !== this.selectedKey && this.selected().kind !== "root") this.picked.add(this.selectedKey);
		this.picked.delete(key);
		this.selectedKey = key;
		this.markSelection();
		if (this.revealInToc(this.selected())) this.renderToc();
		else this.markToc();
		this.renderNote();
		this.ensureVisible();
		if (sync) this.syncSource();
	}

	/** Shift+click: add a node to the selection, or take it out again. */
	private togglePick(key: string): void {
		if (key === this.selectedKey) {
			const next = this.picked.values().next();
			if (next.done) return;
			this.selectedKey = next.value;
			this.select(next.value, true, true);
		} else if (this.picked.delete(key)) {
			this.select(this.selectedKey, true, true);
		} else {
			this.select(key, true, true);
		}
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
		if (this.file) this.plugin.setCollapsed(this.file.path, [...this.collapsed]);
	}

	/** Carry fold state over to new keys; each pair is [old key, new key] of a node that changed. */
	private remapKeys(pairs: [string, string][]): void {
		const moved = pairs.filter(([a, b]) => a !== b);
		if (!moved.length) return;
		const next = new Set<string>();
		for (const k of this.collapsed) {
			const hit = moved.find(([a]) => k === a || k.startsWith(`${a}/`));
			next.add(hit ? hit[1] + k.slice(hit[0].length) : k);
		}
		this.collapsed = next;
		this.persistCollapsed();
	}

	private async addNode(kind: "child" | "sibling"): Promise<void> {
		this.picked.clear();
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
		startInlineEdit(el, node.text, (text, next) => void this.finishEdit(node, text, next));
	}

	/** Tab after any edit adds a child; Enter adds a sibling only while typing a run of new nodes. */
	private async finishEdit(node: OutlineNode, text: string | null, next: "child" | "sibling" | null): Promise<void> {
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
			if (updated) this.remapKeys([[oldKey, updated.key]]);
			this.afterEdit(res);
		} else {
			this.render();
		}
		this.hostEl.focus({ preventScroll: true });
		if (!value) return;
		if (next === "child") await this.addNode("child");
		else if (next === "sibling" && isNew) await this.addNode("sibling");
	}

	private async remove(): Promise<void> {
		const nodes = topmost(this.selection());
		const first = nodes[0];
		if (!first?.parent) return;
		const gone = new Set(nodes);
		const kept = first.parent.children.filter((n) => n === first || !gone.has(n));
		const i = kept.indexOf(first);
		const fallback = [kept[i + 1], kept[i - 1], first.parent]
			.filter((n): n is OutlineNode => !!n)
			.map((n) => n.key);
		const res = await this.apply((o) => deleteNodes(o, nodes));
		if (!res) return;
		this.picked.clear();
		this.selectedKey = fallback.find((k) => findByKey(this.outline, k)) ?? "";
		this.afterEdit(res);
	}

	private async copyNode(cut: boolean): Promise<void> {
		const nodes = topmost(this.selection());
		if (!nodes.length) return;
		const md = nodes.map((n) => copyBlock(this.outline, n)).join("\n");
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
		if (!node.children.length) return;
		if (!this.collapsed.delete(key)) this.collapsed.add(key);
		this.fixSelection();
		this.persistCollapsed();
		this.render();
	}

	/** Show `n` levels below the root; every deeper branch is folded. */
	private setLevel(n: number): void {
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
			this.collapsed.delete(sel.node.key);
			this.persistCollapsed();
			this.render();
			this.go(dir);
		} else if (r.item) {
			this.select(r.item.node.key);
		}
	}

	private onKey(e: KeyboardEvent): void {
		if (this.editing || e.isComposing) return;
		if (this.picked.size && e.key === "Escape") {
			e.preventDefault();
			this.picked.clear();
			this.markSelection();
			return;
		}
		if (this.pickMode && e.key === "Escape") {
			e.preventDefault();
			this.togglePickMode();
			return;
		}
		const handled = handleKey(e, {
			undoRedo: (redo) => void this.undoRedo(redo),
			move: (dir) => void this.move(dir),
			go: (dir) => this.go(dir),
			addNode: (kind) => void this.addNode(kind),
			remove: () => void this.remove(),
			edit: () => this.beginEdit(),
			fold: () => this.toggleFold(this.selectedKey),
			level: (n) => this.setLevel(n),
			search: () => this.openSearch(),
			copy: () => void this.copyNode(false),
			cut: () => void this.copyNode(true),
			paste: () => void this.pasteNode(),
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
			const node = findByKey(this.outline, key);
			if (e.shiftKey && node && node.kind !== "root") {
				e.preventDefault();
				this.togglePick(key);
			} else if (node && target.closest(".mt-check")) {
				this.select(key);
				e.preventDefault();
				void this.toggleTaskNode(node);
			} else if (node && (e.metaKey || e.ctrlKey) && this.openLink(node)) {
				this.select(key);
				e.preventDefault();
			} else if (node && this.pickMode && node.kind !== "root") {
				// In multi-select mode a tap adds or removes the node; dragging a picked node moves them all.
				const keep = this.picked.has(key) || key === this.selectedKey;
				this.beginDrag(e, keep ? topmost(this.selection()) : [node], () => this.togglePick(key));
			} else if (node && node.kind !== "root") {
				// Pressing on a node that is already part of a multi-selection drags all of them.
				const keep = this.picked.size > 0 && (this.picked.has(key) || key === this.selectedKey);
				if (keep) this.select(key, true, true);
				else this.select(key);
				this.beginDrag(e, keep ? topmost(this.selection()) : [node], keep ? () => this.select(key) : undefined);
			} else {
				this.select(key);
			}
		} else if (this.boxSelects(e)) {
			e.preventDefault();
			this.beginMarquee(e);
		} else if (this.picked.size) {
			this.picked.clear();
			this.markSelection();
		}
		this.hostEl.focus({ preventScroll: true });
	}

	/** Whether a press on empty space draws a selection rectangle; Shift swaps it with panning. */
	private boxSelects(e: PointerEvent): boolean {
		return this.pickMode || this.plugin.dragSelects() !== e.shiftKey;
	}

	togglePickMode(): void {
		this.pickMode = !this.pickMode;
		this.pickBtn?.toggleClass("is-active", this.pickMode);
		this.hostEl.toggleClass("is-picking", this.pickMode);
	}

	/** A rectangle drawn on empty space selects every node it touches, on top of the selection with Shift or in multi-select mode. */
	private beginMarquee(e: PointerEvent): void {
		const base = e.shiftKey || this.pickMode ? this.selection().filter((n) => n.kind !== "root") : [];
		if (!base.length) this.picked.clear();
		const origin = this.selectedKey;
		startMarquee(e, {
			host: this.hostEl,
			items: () => this.drawn?.items ?? [],
			toStage: (x, y) => this.viewport.toStage(x, y),
			onChange: (hit) => {
				const keys = [...new Set([...base, ...hit.map((i) => i.node)].map((n) => n.key))];
				this.selectedKey = keys.includes(origin) ? origin : (keys[0] ?? origin);
				this.picked = new Set(keys.filter((k) => k !== this.selectedKey));
				this.markSelection();
			},
			onEnd: () => this.select(this.selectedKey, true, true),
		});
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
		if (updated) this.remapKeys([[oldKey, updated.key]]);
		this.afterEdit(res);
	}

	private beginDrag(e: PointerEvent, nodes: OutlineNode[], onClick?: () => void): void {
		const label = displayText(nodes[0].text);
		startDrag(e, {
			host: this.hostEl,
			nodes,
			label: nodes.length > 1 ? `${label} +${nodes.length - 1}` : label,
			items: () => this.drawn?.items ?? [],
			elOf: (key) => this.drawn?.els.get(key),
			toStage: (x, y) => this.viewport.toStage(x, y),
			isValid: (t) => moveNodes(this.outline, nodes, t.node, t.pos).text !== this.text,
			refusal: (node) => t(`drop.${dropRefusal(nodes, node)}` as const),
			describe: (target) => t(`drag.${target.pos}` as const, { name: displayText(target.node.text) }),
			onDrop: (t) => void this.dropNodes(nodes, t),
			onClick,
		});
	}

	private async dropNodes(nodes: OutlineNode[], t: DropTarget): Promise<void> {
		const oldKeys = nodes.map((n) => n.key);
		const primary = Math.max(0, oldKeys.indexOf(this.selectedKey));
		if (t.pos === "child") {
			this.collapsed.delete(t.node.key);
			this.persistCollapsed();
		}
		const res = await this.apply((o) => moveNodes(o, nodes, t.node, t.pos));
		if (!res?.lines) return this.afterEdit(res);
		const moved = res.lines.map((l) => findByLine(this.outline, l));
		this.remapKeys(oldKeys.map((k, i) => [k, moved[i]?.key ?? k]));
		const keys = moved.filter((n): n is OutlineNode => !!n).map((n) => n.key);
		this.picked = new Set(keys.filter((k) => k !== moved[primary]?.key));
		this.afterEdit({ ...res, focusLine: res.lines[primary] });
	}

	private onDblClick(e: MouseEvent): void {
		const nodeEl = (e.target as HTMLElement).closest<HTMLElement>(".mt-node");
		if (!nodeEl || this.editing) return;
		this.select(nodeEl.dataset.key ?? "");
		this.beginEdit();
	}

	private buildBar(bar: HTMLElement): void {
		const act = (fn: () => unknown) => () => {
			if (!this.editing) void fn();
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
				{
					icon: "list-checks",
					label: t("tb.pick"),
					run: () => this.togglePickMode(),
					ref: (btn) => {
						this.pickBtn = btn;
					},
				},
			],
			[
				{ icon: "chevrons-up-down", label: t("tb.expandAll"), run: act(() => this.setLevel(Infinity)) },
				{ icon: "chevrons-down-up", label: t("tb.collapse"), run: act(() => this.setLevel(1)) },
				{ icon: "search", label: t("tb.search"), run: () => this.openSearch() },
				{ icon: "list", label: t("tb.toc"), run: () => this.toggleToc() },
				{ icon: "sticky-note", label: t("tb.notes"), run: () => this.toggleNote() },
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
		this.picked.clear();
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
		if (this.file) this.plugin.setTocCollapsed(this.file.path, [...this.tocCollapsed]);
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
		const sig = `${node.key}\0${text}`;
		if (sig === this.noteSig) return;
		this.noteSig = sig;
		this.noteTitle.setText(node.kind === "root" ? t("note.title") : t("note.titleFor", { name: displayText(node.text) }));
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
		if (node.kind === "root" || this.editing) return;
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
