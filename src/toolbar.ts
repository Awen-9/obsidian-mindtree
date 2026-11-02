import { setIcon } from "obsidian";

export interface ToolbarButton {
	icon: string;
	label: string;
	run: (e: MouseEvent) => void;
	/** receives the button, e.g. to show an on/off state later */
	ref?: (btn: HTMLElement) => void;
}

export function buildToolbar(bar: HTMLElement, groups: ToolbarButton[][]): void {
	groups.forEach((group, i) => {
		if (i > 0) bar.createDiv({ cls: "mt-sep" });
		for (const b of group) {
			const btn = bar.createEl("button", { cls: "clickable-icon mt-btn", attr: { "aria-label": b.label } });
			setIcon(btn, b.icon);
			btn.addEventListener("pointerdown", (e) => e.preventDefault());
			btn.addEventListener("click", b.run);
			b.ref?.(btn);
		}
	});
}
