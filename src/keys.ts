import type { Dir } from "./nav.ts";

export interface KeyActions {
	undoRedo(redo: boolean): void;
	move(dir: -1 | 1): void;
	go(dir: Dir): void;
	addNode(kind: "child" | "sibling"): void;
	remove(): void;
	edit(): void;
	fold(): void;
	level(n: number): void;
	search(): void;
	copy(): void;
	cut(): void;
	paste(): void;
}

const ARROWS: Record<string, Dir> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

/** Returns true when the key was a map shortcut; the caller then cancels the default action. */
export function handleKey(e: KeyboardEvent, a: KeyActions): boolean {
	const mod = e.metaKey || e.ctrlKey;
	const key = e.key.toLowerCase();
	if (mod && key === "z") a.undoRedo(e.shiftKey);
	else if (mod && key === "y") a.undoRedo(true);
	else if (mod && key === "f") a.search();
	else if (mod && key === "c") a.copy();
	else if (mod && key === "x") a.cut();
	else if (mod && key === "v") a.paste();
	else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) a.move(e.key === "ArrowUp" ? -1 : 1);
	else if (mod || e.altKey) return false;
	else if (ARROWS[e.key]) a.go(ARROWS[e.key]);
	else if (e.key === "Enter") a.addNode("sibling");
	else if (e.key === "Tab") a.addNode("child");
	else if (e.key === "Delete" || e.key === "Backspace") a.remove();
	else if (e.key === "F2") a.edit();
	else if (e.key === " ") a.fold();
	else if (/^[1-9]$/.test(e.key)) a.level(Number(e.key));
	else return false;
	return true;
}
