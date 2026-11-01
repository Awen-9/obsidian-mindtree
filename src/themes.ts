import type { Key } from "./i18n.ts";

export const THEMES = [
	{ id: "default", label: "theme.default" },
	{ id: "soft", label: "theme.soft" },
	{ id: "business", label: "theme.business" },
	{ id: "bold", label: "theme.bold" },
	{ id: "mono", label: "theme.mono" },
] as const satisfies readonly { id: string; label: Key }[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
