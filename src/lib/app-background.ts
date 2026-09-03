import { applyAppTheme, loadAppThemeId } from "./app-theme.ts";
import { APP_BACKGROUND_STORAGE_KEY } from "./client-storage-keys.ts";
import { readStoredJson, writeStoredJson } from "./stored-json.ts";

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

export interface AppBackgroundSettings {
	version: 6;
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
	version: 6,
	mode: "solid",
	id: "none",
	dim: 42,
	blur: 1,
	glassBlur: 24,
	glassOpacity: 46,
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

const BUILT_IN_PALETTES: Partial<Record<AppBackgroundId, BackgroundPalette>> = {
	city: {
		black: "#050506",
		darkGray: "#1b1c20",
		gray: "#2b2c31",
		lightGray: "#3b3d44",
		accent: "#8299bd",
		accentHover: "#98acc9",
	},
	nature: {
		black: "#050606",
		darkGray: "#1b1d1c",
		gray: "#2b2e2d",
		lightGray: "#3b3f3d",
		accent: "#7d9f95",
		accentHover: "#94b0a8",
	},
	orbit: {
		black: "#060505",
		darkGray: "#1d1b19",
		gray: "#2e2b28",
		lightGray: "#403c37",
		accent: "#ac916f",
		accentHover: "#bda687",
	},
	signals: {
		black: "#050506",
		darkGray: "#1b1b20",
		gray: "#2b2b32",
		lightGray: "#3c3c46",
		accent: "#898eb3",
		accentHover: "#9fa3c2",
	},
};

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
		version: 6,
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
			stored.version === 6
				? stored.glassBlur
				: DEFAULT_APP_BACKGROUND_SETTINGS.glassBlur,
			0,
			40,
			DEFAULT_APP_BACKGROUND_SETTINGS.glassBlur,
		),
		glassOpacity: clamp(
			stored.glassOpacity,
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
	const context = canvas.getContext("2d", { willReadFrequently: true });
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
	const builtIn = BUILT_IN_PALETTES[id];
	if (builtIn) return builtIn;
	if (id === "custom" && imageUrl) return deriveCustomPalette(imageUrl);
	return null;
}

export function applyAppBackgroundPalette(
	palette: BackgroundPalette | null,
): void {
	if (!palette) {
		applyAppTheme(loadAppThemeId());
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
