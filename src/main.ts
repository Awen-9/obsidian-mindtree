import { EditorView } from "@codemirror/view";
import { MarkdownView, Plugin, TFile, editorInfoField } from "obsidian";
import type { Outline } from "./outline.ts";
import { t } from "./i18n.ts";
import { MindTreeSettingTab } from "./settings.ts";
import { isTheme, type ThemeId } from "./themes.ts";
import { tocEntries } from "./toc.ts";
import { MindView, VIEW_TYPE } from "./view.ts";

interface PluginData {
	/** vault path -> keys of folded nodes */
	collapsed: Record<string, string[]>;
	/** vault path -> keys of folded headings in the table of contents */
	tocCollapsed: Record<string, string[]>;
	theme: ThemeId;
	toc: boolean;
	note: boolean;
	/** a plain drag on empty space draws a selection rectangle and Shift+drag pans, instead of the other way round */
	dragSelects: boolean;
}

export default class MindTreePlugin extends Plugin {
	private data: PluginData = {
		collapsed: {},
		tocCollapsed: {},
		theme: "default",
		toc: true,
		note: false,
		dragSelects: false,
	};
	private saveTimer: number | null = null;

	async onload(): Promise<void> {
		const saved = (await this.loadData()) as Partial<PluginData> | null;
		this.data = {
			collapsed: saved?.collapsed ?? {},
			tocCollapsed: saved?.tocCollapsed ?? {},
			theme: isTheme(saved?.theme) ? saved.theme : "default",
			toc: saved?.toc ?? true,
			note: saved?.note ?? false,
			dragSelects: saved?.dragSelects ?? false,
		};

		this.registerView(VIEW_TYPE, (leaf) => new MindView(leaf, this));
		this.addSettingTab(new MindTreeSettingTab(this.app, this));
		this.addRibbonIcon("network", t("ribbon"), () => this.toggleActive());
		this.registerEditorExtension(
			EditorView.updateListener.of((u) => {
				if (!u.selectionSet || !u.view.hasFocus) return;
				const file = u.state.field(editorInfoField, false)?.file;
				if (!file) return;
				const line = u.state.doc.lineAt(u.state.selection.main.head).number - 1;
				for (const view of this.mindViews()) if (view.file === file) view.selectLine(line);
			}),
		);

		this.addCommand({
			id: "open-as-mindmap",
			name: t("cmd.open"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.openInMindmap(file, false);
				return true;
			},
		});
		this.addCommand({
			id: "open-as-markdown",
			name: t("cmd.markdown"),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MindView);
				if (!view) return false;
				if (!checking) view.openMarkdown();
				return true;
			},
		});
		const viewCommands: [string, string, (v: MindView) => void][] = [
			["search-mindmap", t("cmd.search"), (v) => v.openSearch()],
			["toggle-toc", t("cmd.toc"), (v) => v.toggleToc()],
			["toggle-note", t("cmd.notes"), (v) => v.toggleNote()],
			["edit-note", t("cmd.editNote"), (v) => v.editNote()],
			["toggle-recall", t("cmd.recall"), (v) => v.toggleRecall()],
			["export-png", t("cmd.png"), (v) => void v.exportImage("png")],
			["export-svg", t("cmd.svg"), (v) => void v.exportImage("svg")],
			["source-beside", t("cmd.source"), (v) => v.file && void this.openSourceBeside(v.file)],
		];
		for (const [id, name, run] of viewCommands) {
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const view = this.app.workspace.getActiveViewOfType(MindView);
					if (!view) return false;
					if (!checking) run(view);
					return true;
				},
			});
		}

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle(t("menu.open"))
						.setIcon("network")
						.onClick(() => void this.openInMindmap(file, true)),
				);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const keys = this.data.collapsed[oldPath];
				if (!keys) return;
				delete this.data.collapsed[oldPath];
				this.data.collapsed[file.path] = keys;
				this.scheduleSave();
			}),
		);
	}

	onunload(): void {
		if (this.saveTimer === null) return;
		window.clearTimeout(this.saveTimer);
		void this.saveData(this.data);
	}

	private toggleActive(): void {
		const view = this.app.workspace.getActiveViewOfType(MindView);
		if (view) return view.openMarkdown();
		const file = this.app.workspace.getActiveFile();
		if (file?.extension === "md") void this.openInMindmap(file, false);
	}

	private async openInMindmap(file: TFile, newTab: boolean): Promise<void> {
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
	}

	private mindViews(): MindView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((l) => l.view)
			.filter((v): v is MindView => v instanceof MindView);
	}

	private markdownViews(file: TFile): MarkdownView[] {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((l) => l.view)
			.filter((v): v is MarkdownView => v instanceof MarkdownView && v.file === file);
	}

	async openSourceBeside(file: TFile): Promise<void> {
		const open = this.markdownViews(file)[0];
		if (open) return void (await this.app.workspace.revealLeaf(open.leaf));
		const leaf = this.app.workspace.getLeaf("split", "vertical");
		await leaf.openFile(file, { active: false });
	}

	/** Put the Markdown cursor on the selected node when the source is open next to the map. */
	revealInSource(file: TFile, line: number, ch: number): void {
		for (const view of this.markdownViews(file)) {
			try {
				view.editor.setCursor({ line, ch });
				view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
			} catch {
				// The editor has not picked up the latest write yet; the next selection will sync.
			}
		}
	}

	getTheme(): ThemeId {
		return this.data.theme;
	}

	setTheme(theme: ThemeId): void {
		this.data.theme = theme;
		this.scheduleSave();
		for (const view of this.mindViews()) view.applyTheme();
	}

	isTocOpen(): boolean {
		return this.data.toc;
	}

	setTocOpen(open: boolean): void {
		this.data.toc = open;
		this.scheduleSave();
	}

	isNoteOpen(): boolean {
		return this.data.note;
	}

	setNoteOpen(open: boolean): void {
		this.data.note = open;
		this.scheduleSave();
	}

	dragSelects(): boolean {
		return this.data.dragSelects;
	}

	setDragSelects(on: boolean): void {
		this.data.dragSelects = on;
		this.scheduleSave();
	}

	getCollapsed(path: string, outline: Outline): Set<string> {
		const valid = new Set(outline.nodes.map((n) => n.key));
		valid.add("");
		return new Set((this.data.collapsed[path] ?? []).filter((k) => valid.has(k)));
	}

	setCollapsed(path: string, keys: string[]): void {
		if (keys.length) this.data.collapsed[path] = keys;
		else delete this.data.collapsed[path];
		this.scheduleSave();
	}

	getTocCollapsed(path: string, outline: Outline): Set<string> {
		const valid = new Set(tocEntries(outline.nodes).map((n) => n.key));
		return new Set((this.data.tocCollapsed[path] ?? []).filter((k) => valid.has(k)));
	}

	setTocCollapsed(path: string, keys: string[]): void {
		if (keys.length) this.data.tocCollapsed[path] = keys;
		else delete this.data.tocCollapsed[path];
		this.scheduleSave();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveData(this.data);
		}, 800);
	}
}
