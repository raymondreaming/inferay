import { APP_FONT_STORAGE_KEY } from "../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../adapters/storage/stored-values.ts";

export const APP_FONTS = [
	{ id: "geist", label: "Geist", family: '"Geist", sans-serif' },
	{ id: "inter", label: "Inter", family: '"Inter", sans-serif' },
	{ id: "manrope", label: "Manrope", family: '"Manrope", sans-serif' },
	{
		id: "ibm-plex-sans",
		label: "IBM Plex Sans",
		family: '"IBM Plex Sans", sans-serif',
	},
	{
		id: "system",
		label: "System",
		family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	},
] as const;

export type AppFontId = (typeof APP_FONTS)[number]["id"];
export const DEFAULT_APP_FONT_ID: AppFontId = "geist";

export function isAppFontId(value: unknown): value is AppFontId {
	return APP_FONTS.some((font) => font.id === value);
}

export function loadAppFontId(): AppFontId {
	const stored = readStoredValue(APP_FONT_STORAGE_KEY);
	return isAppFontId(stored) ? stored : DEFAULT_APP_FONT_ID;
}

export function applyAppFont(id: AppFontId): void {
	const selected = APP_FONTS.find((font) => font.id === id) ?? APP_FONTS[0];
	const root = document.documentElement;
	root.style.setProperty("--font-sans", selected.family);
	root.style.setProperty("--font-mono", selected.family);
	root.style.setProperty("--font-diff", selected.family);
}

export function saveAppFontId(id: AppFontId): void {
	writeStoredValue(APP_FONT_STORAGE_KEY, id);
}
