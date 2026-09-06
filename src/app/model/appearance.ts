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

// Only custom image palettes write inline colors. Clear them when choosing a theme.
const CUSTOM_PALETTE_PROPERTIES = [
	"--color-inferay-black",
	"--color-inferay-dark-gray",
	"--color-inferay-gray",
	"--color-inferay-light-gray",
	"--color-inferay-accent",
	"--color-inferay-accent-hover",
	"--color-inferay-accent-foreground",
	"--color-inferay-info",
] as const;
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
	for (const property of CUSTOM_PALETTE_PROPERTIES) {
		root.style.removeProperty(property);
	}
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
interface BackgroundPalette {
	black: string;
	darkGray: string;
	gray: string;
	lightGray: string;
	accent: string;
	accentHover: string;
}
function clamp(value: unknown, min: number, max: number, fallback: number) {
	const number = Number(value);
	return Number.isFinite(number)
		? Math.min(max, Math.max(min, number))
		: fallback;
}
function isBackgroundId(value: unknown): value is AppBackgroundId {
	return (
		value === "custom" ||
		value === "none" ||
		APP_BACKGROUNDS.some((background) => background.id === value)
	);
}
function isBackgroundMode(value: unknown): value is AppBackgroundMode {
	return value === "solid" || value === "scene" || value === "glass";
}
export function loadAppBackgroundSettings(): AppBackgroundSettings {
	const stored = readStoredJson<
		Partial<Omit<AppBackgroundSettings, "version">> & { version?: number }
	>(APP_BACKGROUND_STORAGE_KEY, DEFAULT_APP_BACKGROUND_SETTINGS);
	const storedBlur = clamp(
		stored.blur,
		0,
		20,
		DEFAULT_APP_BACKGROUND_SETTINGS.blur,
	);
	return {
		version: 7,
		mode: isBackgroundMode(stored.mode)
			? stored.mode
			: stored.id && stored.id !== "none"
				? "scene"
				: "solid",
		id: isBackgroundId(stored.id)
			? stored.id
			: DEFAULT_APP_BACKGROUND_SETTINGS.id,
		dim: clamp(stored.dim, 0, 85, DEFAULT_APP_BACKGROUND_SETTINGS.dim),
		blur:
			stored.version === 2 || stored.version === 3
				? storedBlur
				: Math.min(1, storedBlur),
		glassBlur: clamp(
			stored.version === 7
				? stored.glassBlur
				: DEFAULT_APP_BACKGROUND_SETTINGS.glassBlur,
			0,
			40,
			DEFAULT_APP_BACKGROUND_SETTINGS.glassBlur,
		),
		glassOpacity: clamp(
			stored.version === 7
				? stored.glassOpacity
				: DEFAULT_APP_BACKGROUND_SETTINGS.glassOpacity,
			8,
			100,
			DEFAULT_APP_BACKGROUND_SETTINGS.glassOpacity,
		),
		autoTheme:
			typeof stored.autoTheme === "boolean"
				? stored.autoTheme
				: DEFAULT_APP_BACKGROUND_SETTINGS.autoTheme,
		customRevision: clamp(stored.customRevision, 0, Number.MAX_SAFE_INTEGER, 0),
	};
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
function channelToHex(value: number) {
	return Math.round(Math.min(255, Math.max(0, value)))
		.toString(16)
		.padStart(2, "0");
}
function rgbToHex(red: number, green: number, blue: number) {
	return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}
function foregroundForHex(hex: string) {
	const value = Number.parseInt(hex.slice(1), 16);
	const red = (value >> 16) & 255;
	const green = (value >> 8) & 255;
	const blue = value & 255;
	return (red * 299 + green * 587 + blue * 114) / 1000 > 145
		? "#111111"
		: "#f8f8f8";
}
function mixRgb(
	color: [number, number, number],
	target: [number, number, number],
	amount: number,
): [number, number, number] {
	return color.map(
		(channel, index) => channel + (target[index]! - channel) * amount,
	) as [number, number, number];
}
async function deriveCustomPalette(
	imageUrl: string,
): Promise<BackgroundPalette> {
	const image = new Image();
	image.crossOrigin = "anonymous";
	image.src = imageUrl;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = 48;
	canvas.height = 48;
	const context = canvas.getContext("2d", {
		willReadFrequently: true,
	});
	if (!context) throw new Error("Canvas unavailable");
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	const candidates: Array<{
		color: [number, number, number];
		weight: number;
	}> = [];
	for (let index = 0; index < pixels.length; index += 16) {
		const red = pixels[index] ?? 0;
		const green = pixels[index + 1] ?? 0;
		const blue = pixels[index + 2] ?? 0;
		const max = Math.max(red, green, blue);
		const min = Math.min(red, green, blue);
		const lightness = (max + min) / 510;
		const saturation = max === 0 ? 0 : (max - min) / max;
		if (lightness < 0.16 || lightness > 0.88 || saturation < 0.12) continue;
		candidates.push({
			color: [red, green, blue],
			weight: saturation * (1 - Math.abs(lightness - 0.55)),
		});
	}
	candidates.sort((a, b) => b.weight - a.weight);
	const selected = candidates.slice(0, Math.max(8, candidates.length / 8));
	const totals = selected.reduce<[number, number, number]>(
		(total, sample) => [
			total[0] + sample.color[0],
			total[1] + sample.color[1],
			total[2] + sample.color[2],
		],
		[0, 0, 0],
	);
	const source: [number, number, number] =
		selected.length > 0
			? [
					totals[0] / selected.length,
					totals[1] / selected.length,
					totals[2] / selected.length,
				]
			: [104, 128, 180];
	const accent = mixRgb(source, [255, 255, 255], 0.2);
	const mutedAccent = mixRgb(accent, [135, 135, 140], 0.58);
	return {
		black: rgbToHex(...mixRgb([5, 5, 6], mutedAccent, 0.015)),
		darkGray: rgbToHex(...mixRgb([28, 28, 30], mutedAccent, 0.05)),
		gray: rgbToHex(...mixRgb([44, 44, 46], mutedAccent, 0.075)),
		lightGray: rgbToHex(...mixRgb([58, 58, 60], mutedAccent, 0.1)),
		accent: rgbToHex(...mutedAccent),
		accentHover: rgbToHex(...mixRgb(mutedAccent, [255, 255, 255], 0.14)),
	};
}
export async function deriveAppBackgroundPalette(
	id: AppBackgroundId,
	imageUrl: string | null,
): Promise<BackgroundPalette | null> {
	if (id === "none") return null;
	if (id === "custom" && imageUrl) return deriveCustomPalette(imageUrl);
	return null;
}
export function applyAppBackgroundPalette(
	palette: BackgroundPalette | null,
	id: AppBackgroundId,
): void {
	applyAppTheme(loadAppThemeId());
	if (!palette) {
		if (APP_BACKGROUNDS.some((background) => background.id === id)) {
			document.documentElement.dataset.inferayScene = id;
		}
		return;
	}
	const root = document.documentElement;
	root.style.setProperty("--color-inferay-black", palette.black);
	root.style.setProperty("--color-inferay-dark-gray", palette.darkGray);
	root.style.setProperty("--color-inferay-gray", palette.gray);
	root.style.setProperty("--color-inferay-light-gray", palette.lightGray);
	root.style.setProperty("--color-inferay-accent", palette.accent);
	root.style.setProperty("--color-inferay-accent-hover", palette.accentHover);
	root.style.setProperty(
		"--color-inferay-accent-foreground",
		foregroundForHex(palette.accent),
	);
	root.style.setProperty("--color-inferay-info", palette.accent);
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
