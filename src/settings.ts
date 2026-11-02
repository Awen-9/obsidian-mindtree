import { App, PluginSettingTab, Setting } from "obsidian";
import { t } from "./i18n.ts";
import type MindTreePlugin from "./main.ts";
import { THEMES, type ThemeId } from "./themes.ts";

export class MindTreeSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: MindTreePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(t("settings.theme")).setDesc(t("settings.themeDesc")).addDropdown((d) => {
			for (const theme of THEMES) d.addOption(theme.id, t(theme.label));
			d.setValue(this.plugin.getTheme()).onChange((v) => this.plugin.setTheme(v as ThemeId));
		});

		new Setting(containerEl)
			.setName(t("settings.toc"))
			.setDesc(t("settings.tocDesc"))
			.addToggle((tg) => tg.setValue(this.plugin.isTocOpen()).onChange((v) => this.plugin.setTocOpen(v)));

		new Setting(containerEl)
			.setName(t("settings.note"))
			.setDesc(t("settings.noteDesc"))
			.addToggle((tg) => tg.setValue(this.plugin.isNoteOpen()).onChange((v) => this.plugin.setNoteOpen(v)));

		new Setting(containerEl)
			.setName(t("settings.dragSelects"))
			.setDesc(t("settings.dragSelectsDesc"))
			.addToggle((tg) => tg.setValue(this.plugin.dragSelects()).onChange((v) => this.plugin.setDragSelects(v)));
	}
}
