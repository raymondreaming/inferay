import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
	readStoredJson,
	readStoredValue,
	writeStoredJson,
	writeStoredValue,
} from "../../adapters/storage/stored-values.ts";
export const APP_THEMES = [
	{
		id: "default",
		name: "Black",
	},
	{
		id: "midnight",
		name: "Midnight",
	},
] as const;
export type AppThemeId = (typeof APP_THEMES)[number]["id"];

// Native window dragging uses these class names.
export const APP_REGION_DRAG_CLASS = "electrobun-webkit-app-region-drag";
export const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";

export function loadAppThemeId(): AppThemeId {
	return readStoredValue(APP_THEME_STORAGE_KEY) === "midnight"
		? "midnight"
		: "default";
}
export function saveAppThemeId(id: AppThemeId): void {
	writeStoredValue(APP_THEME_STORAGE_KEY, id);
}
export function applyAppTheme(id: AppThemeId): void {
	const root = document.documentElement;
	delete root.dataset.inferayScene;
	root.dataset.inferayTheme = id;
}
export const APP_BACKGROUNDS = [
	{
		id: "city",
		name: "City rain",
		path: "/background-city-rain.png",
	},
	{
		id: "nature",
		name: "Night garden",
		path: "/background-nature-sanctuary.png",
	},
	{
		id: "orbit",
		name: "Orbital study",
		path: "/background-orbital-study.png",
	},
	{
		id: "signals",
		name: "Signal field",
		path: "/inferay-vibespace.png",
	},
] as const;
export type AppBackgroundId =
	| (typeof APP_BACKGROUNDS)[number]["id"]
	| "custom"
	| "none";
export type AppBackgroundMode = "solid" | "scene" | "glass";

/** CSS owns mode-specific surface colors; registered tokens resolve at the root. */
export function applyAppBackgroundSurfaces(mode: AppBackgroundMode): void {
	document.documentElement.dataset.inferayBackground = mode;
}
export interface AppBackgroundSettings {
	version: 7;
	mode: AppBackgroundMode;
	id: AppBackgroundId;
	dim: number;
	blur: number;
	glassBlur: number;
	glassOpacity: number;
	autoTheme: boolean;
	customRevision: number;
}
export const DEFAULT_APP_BACKGROUND_SETTINGS: AppBackgroundSettings = {
	version: 7,
	mode: "solid",
	id: "none",
	dim: 42,
	blur: 1,
	glassBlur: 7,
	glassOpacity: 83,
	autoTheme: false,
	customRevision: 0,
};
export function loadAppBackgroundSettings(): AppBackgroundSettings {
	return readStoredJson(
		APP_BACKGROUND_STORAGE_KEY,
		DEFAULT_APP_BACKGROUND_SETTINGS,
	);
}
export function saveAppBackgroundSettings(
	settings: AppBackgroundSettings,
): void {
	applyAppBackgroundSurfaces(settings.mode);
	writeStoredJson(APP_BACKGROUND_STORAGE_KEY, settings);
}
export function getBuiltInBackgroundPath(id: AppBackgroundId): string | null {
	return (
		APP_BACKGROUNDS.find((background) => background.id === id)?.path ?? null
	);
}
export function applyAppBackgroundPalette(id: AppBackgroundId): void {
	applyAppTheme(loadAppThemeId());
	if (APP_BACKGROUNDS.some((background) => background.id === id)) {
		document.documentElement.dataset.inferayScene = id;
	}
}
export function restoreAppTheme(): void {
	applyAppTheme(loadAppThemeId());
}

import { APP_FONT_STORAGE_KEY } from "../../adapters/storage/stored-values.ts";
export const APP_FONTS = [
	{
		id: "geist",
		label: "Geist",
		family: '"Geist", sans-serif',
	},
	{
		id: "inter",
		label: "Inter",
		family: '"Inter", sans-serif',
	},
	{
		id: "manrope",
		label: "Manrope",
		family: '"Manrope", sans-serif',
	},
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
export type Step = "intro" | "github" | "projects" | "complete";
export function getStepPhase(current: Step, target: Step) {
	const order: Step[] = ["intro", "github", "projects", "complete"];
	return current === target
		? "active"
		: order.indexOf(current) < order.indexOf(target)
			? "before"
			: "after";
}

import { fetchJsonOr } from "../../adapters/backend/http.ts";
import { useQueryResource } from "../../shared/hooks/useQueryResource.tsx";
export interface AppInfo {
	name: string;
	version: string;
	hash?: string;
	channel: string;
	identifier?: string;
	production: boolean;
	update: {
		available: boolean;
		currentVersion: string;
		latestVersion: string | null;
		url: string | null;
		error?: string;
	};
}
export const FALLBACK_APP_INFO: AppInfo = {
	name: "inferay",
	version: "dev",
	channel: "dev",
	production: false,
	update: {
		available: false,
		currentVersion: "dev",
		latestVersion: null,
		url: null,
	},
};
function fetchAppInfo() {
	return fetchJsonOr("/api/app-info", FALLBACK_APP_INFO);
}
export function useAppInfo() {
	return useQueryResource<AppInfo>(fetchAppInfo, FALLBACK_APP_INFO, {
		queryKey: ["app-info"],
	});
}
