import type { ThemeId } from "../features/terminal/terminal-utils.ts";
import { hasId } from "./data.ts";
import {
	readStoredJson,
	readStoredValue,
	writeStoredValue,
} from "./stored-json.ts";

interface AppThemeColors {
	readonly black: string;
	readonly darkGray: string;
	readonly gray: string;
	readonly lightGray: string;
	readonly grayBorder: string;
	readonly grayBorderBold: string;
	readonly accent: string;
	readonly accentHover: string;
	readonly success: string;
	readonly warning: string;
	readonly error: string;
	readonly info: string;
	readonly white: string;
	readonly softWhite: string;
	readonly mutedGray: string;
}

interface AppTheme {
	readonly id: AppThemeId;
	readonly name: string;
	readonly colors: AppThemeColors;
	readonly light?: boolean;
}

const APP_THEME_IDS = {
	default: "default",
	midnight: "midnight",
	nord: "nord",
	dracula: "dracula",
	solarized: "solarized",
	monokai: "monokai",
	github: "github",
	ocean: "ocean",
	rose: "rose",
	githubLight: "githubLight",
	solarizedLight: "solarizedLight",
	custom: "custom",
} as const;

export type AppThemeId = (typeof APP_THEME_IDS)[keyof typeof APP_THEME_IDS];

const CSS_VAR_MAP: Record<keyof AppThemeColors, string> = {
	black: "--color-inferay-black",
	darkGray: "--color-inferay-dark-gray",
	gray: "--color-inferay-gray",
	lightGray: "--color-inferay-light-gray",
	grayBorder: "--color-inferay-gray-border",
	grayBorderBold: "--color-inferay-gray-border-bold",
	accent: "--color-inferay-accent",
	accentHover: "--color-inferay-accent-hover",
	success: "--color-inferay-success",
	warning: "--color-inferay-warning",
	error: "--color-inferay-error",
	info: "--color-inferay-info",
	white: "--color-inferay-white",
	softWhite: "--color-inferay-soft-white",
	mutedGray: "--color-inferay-muted-gray",
};

const ACCENT_FOREGROUND_CSS_VAR = "--color-inferay-accent-foreground" as const;

const DARK_DEPTH_TOKENS = {
	"--effect-inferay-control-depth":
		"linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(0, 0, 0, 0.08) 48%, rgba(0, 0, 0, 0.2))",
	"--effect-inferay-control-depth-hover":
		"linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(0, 0, 0, 0.1) 48%, rgba(0, 0, 0, 0.24))",
	"--effect-inferay-popover-depth":
		"linear-gradient(180deg, rgba(255, 255, 255, 0.014), rgba(0, 0, 0, 0.08) 42%, rgba(0, 0, 0, 0.22))",
	"--shadow-inferay-control-depth":
		"inset 0 1px 0 rgba(255, 255, 255, 0.045), inset 0 -1px 0 rgba(0, 0, 0, 0.42)",
	"--shadow-inferay-control-depth-hover":
		"inset 0 1px 0 rgba(255, 255, 255, 0.055), inset 0 -1px 0 rgba(0, 0, 0, 0.48)",
	"--shadow-inferay-composer-frame": "0 18px 42px rgba(0, 0, 0, 0.34)",
	"--shadow-inferay-composer-frame-focus": "0 18px 42px rgba(0, 0, 0, 0.34)",
	"--shadow-inferay-selected-ring": "0 0 0 1px rgba(255, 255, 255, 0.05)",
	"--shadow-inferay-focus-ring": "0 0 0 1px rgba(229, 229, 231, 0.35)",
	"--shadow-inferay-popover": "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
	"--shadow-inferay-modal": "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
} as const;

const LIGHT_DEPTH_TOKENS = {
	"--effect-inferay-control-depth":
		"linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.54) 46%, rgba(31, 35, 40, 0.045))",
	"--effect-inferay-control-depth-hover":
		"linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.62) 46%, rgba(31, 35, 40, 0.065))",
	"--effect-inferay-popover-depth":
		"linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 248, 250, 0.78) 48%, rgba(31, 35, 40, 0.035))",
	"--shadow-inferay-control-depth":
		"inset 0 1px 0 rgba(255, 255, 255, 0.92), inset 0 -1px 0 rgba(31, 35, 40, 0.09)",
	"--shadow-inferay-control-depth-hover":
		"inset 0 1px 0 rgba(255, 255, 255, 0.98), inset 0 -1px 0 rgba(31, 35, 40, 0.12)",
	"--shadow-inferay-composer-frame": "0 16px 34px rgba(31, 35, 40, 0.12)",
	"--shadow-inferay-composer-frame-focus": "0 16px 34px rgba(31, 35, 40, 0.12)",
	"--shadow-inferay-selected-ring": "0 0 0 1px rgba(31, 35, 40, 0.08)",
	"--shadow-inferay-focus-ring": "0 0 0 1px rgba(9, 105, 218, 0.35)",
	"--shadow-inferay-popover": "0 18px 38px -16px rgba(31, 35, 40, 0.28)",
	"--shadow-inferay-modal": "0 28px 60px -24px rgba(31, 35, 40, 0.34)",
} as const;

// Compact theme data:
// [id, name, black, darkGray, gray, lightGray, grayBorder, grayBorderBold, accent, accentHover, success, warning, error, info, white, softWhite, mutedGray, light?]
type ThemeTuple = [
	AppThemeId,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	"L"?,
];

function makeTheme(t: ThemeTuple): AppTheme {
	const [
		id,
		name,
		black,
		darkGray,
		gray,
		lightGray,
		grayBorder,
		grayBorderBold,
		accent,
		accentHover,
		success,
		warning,
		error,
		info,
		white,
		softWhite,
		mutedGray,
	] = t;
	return {
		id,
		name,
		...(t.length === 18 ? { light: true } : {}),
		colors: {
			black,
			darkGray,
			gray,
			lightGray,
			grayBorder,
			grayBorderBold,
			accent,
			accentHover,
			success,
			warning,
			error,
			info,
			white,
			softWhite,
			mutedGray,
		},
	};
}

// prettier-ignore
const THEME_DATA = [
	[
		"default",
		"Black",
		"#000000",
		"#1c1c1e",
		"#2c2c2e",
		"#3a3a3c",
		"rgba(255, 255, 255, 0.08)",
		"rgba(255, 255, 255, 0.15)",
		"#5A8CFF",
		"#7AA3FF",
		"#30D158",
		"#FF9F0A",
		"#FF453A",
		"#8a8aff",
		"#F5F5F7",
		"rgba(255, 255, 255, 0.55)",
		"rgba(255, 255, 255, 0.3)",
	],
	[
		"midnight",
		"Midnight",
		"#0c0c0f",
		"#151518",
		"#1d1d22",
		"#26262c",
		"rgba(255, 255, 255, 0.07)",
		"rgba(255, 255, 255, 0.13)",
		"#5A8CFF",
		"#7AA3FF",
		"#30D158",
		"#FF9F0A",
		"#FF453A",
		"#8a8aff",
		"#e8e8ec",
		"rgba(255, 255, 255, 0.50)",
		"rgba(255, 255, 255, 0.28)",
	],
	[
		"nord",
		"Nord",
		"#2e3440",
		"#3b4252",
		"#434c5e",
		"#4c566a",
		"rgba(216, 222, 233, 0.08)",
		"rgba(216, 222, 233, 0.15)",
		"#88c0d0",
		"#8fbcbb",
		"#a3be8c",
		"#ebcb8b",
		"#bf616a",
		"#81a1c1",
		"#eceff4",
		"rgba(216, 222, 233, 0.60)",
		"rgba(216, 222, 233, 0.35)",
	],
	[
		"dracula",
		"Dracula",
		"#282a36",
		"#343746",
		"#3e4155",
		"#4a4d64",
		"rgba(248, 248, 242, 0.08)",
		"rgba(248, 248, 242, 0.15)",
		"#bd93f9",
		"#caa9fa",
		"#50fa7b",
		"#f1fa8c",
		"#ff5555",
		"#8be9fd",
		"#f8f8f2",
		"rgba(248, 248, 242, 0.55)",
		"rgba(248, 248, 242, 0.30)",
	],
	[
		"solarized",
		"Solarized",
		"#002b36",
		"#073642",
		"#0e3e4a",
		"#174652",
		"rgba(131, 148, 150, 0.10)",
		"rgba(131, 148, 150, 0.18)",
		"#268bd2",
		"#2aa1f0",
		"#859900",
		"#b58900",
		"#dc322f",
		"#2aa198",
		"#fdf6e3",
		"rgba(147, 161, 161, 0.70)",
		"rgba(147, 161, 161, 0.40)",
	],
	[
		"monokai",
		"Monokai",
		"#272822",
		"#2e2f28",
		"#383930",
		"#44453a",
		"rgba(248, 248, 242, 0.08)",
		"rgba(248, 248, 242, 0.15)",
		"#a6e22e",
		"#b8f340",
		"#a6e22e",
		"#e6db74",
		"#f92672",
		"#66d9ef",
		"#f8f8f2",
		"rgba(248, 248, 242, 0.55)",
		"rgba(248, 248, 242, 0.30)",
	],
	[
		"github",
		"GitHub Dark",
		"#0d1117",
		"#161b22",
		"#1c2129",
		"#262c36",
		"rgba(240, 246, 252, 0.06)",
		"rgba(240, 246, 252, 0.12)",
		"#58a6ff",
		"#79c0ff",
		"#3fb950",
		"#d29922",
		"#f85149",
		"#58a6ff",
		"#f0f6fc",
		"rgba(201, 209, 217, 0.60)",
		"rgba(201, 209, 217, 0.35)",
	],
	[
		"ocean",
		"Ocean",
		"#0d1b2a",
		"#1b2838",
		"#243447",
		"#2d4056",
		"rgba(180, 220, 255, 0.08)",
		"rgba(180, 220, 255, 0.14)",
		"#00b4d8",
		"#48cae4",
		"#06d6a0",
		"#ffd166",
		"#ef476f",
		"#48cae4",
		"#edf6f9",
		"rgba(200, 225, 240, 0.55)",
		"rgba(200, 225, 240, 0.30)",
	],
	[
		"rose",
		"Rose Pine",
		"#191724",
		"#1f1d2e",
		"#26233a",
		"#2e2b40",
		"rgba(224, 222, 244, 0.08)",
		"rgba(224, 222, 244, 0.15)",
		"#c4a7e7",
		"#d4bdf7",
		"#9ccfd8",
		"#f6c177",
		"#eb6f92",
		"#9ccfd8",
		"#e0def4",
		"rgba(224, 222, 244, 0.55)",
		"rgba(224, 222, 244, 0.30)",
	],
	[
		"githubLight",
		"GitHub Light",
		"#ffffff",
		"#f6f8fa",
		"#e1e4e8",
		"#d0d7de",
		"rgba(0, 0, 0, 0.08)",
		"rgba(0, 0, 0, 0.14)",
		"#0969da",
		"#0550ae",
		"#1a7f37",
		"#bf8700",
		"#cf222e",
		"#0969da",
		"#1f2328",
		"rgba(0, 0, 0, 0.55)",
		"rgba(0, 0, 0, 0.30)",
		"L",
	],
	[
		"solarizedLight",
		"Solarized Light",
		"#fdf6e3",
		"#eee8d5",
		"#e0dac7",
		"#d3ccb9",
		"rgba(0, 0, 0, 0.08)",
		"rgba(0, 0, 0, 0.15)",
		"#268bd2",
		"#2aa1f0",
		"#859900",
		"#b58900",
		"#dc322f",
		"#2aa198",
		"#073642",
		"rgba(7, 54, 66, 0.65)",
		"rgba(7, 54, 66, 0.40)",
		"L",
	],
] satisfies [ThemeTuple, ...ThemeTuple[]];

export const APP_THEMES = THEME_DATA.map(makeTheme) as [
	AppTheme,
	...AppTheme[],
];

const DEFAULT_THEME = makeTheme(THEME_DATA[0]);
const DEFAULT_COLORS: AppThemeColors = DEFAULT_THEME.colors;

const APP_THEME_STORAGE_KEY = "inferay-app-theme-id" as const;

const APP_CUSTOM_THEME_KEY = "inferay-app-custom-theme" as const;

const APP_TO_TERMINAL_THEME: Record<AppThemeId, ThemeId> = {
	default: "default",
	midnight: "midnight",
	nord: "nord",
	dracula: "dracula",
	solarized: "solarized",
	monokai: "monokai",
	github: "github",
	ocean: "ocean",
	rose: "rose",
	githubLight: "githubLight",
	solarizedLight: "solarizedLight",
	custom: "custom",
};

export function loadAppThemeId(): AppThemeId {
	try {
		const saved = readStoredValue(APP_THEME_STORAGE_KEY);
		if (saved && saved in APP_THEME_IDS) return saved as AppThemeId;
	} catch {}
	return "default";
}

export function saveAppThemeId(id: AppThemeId): void {
	writeStoredValue(APP_THEME_STORAGE_KEY, id);
}

export function mapAppThemeToTerminalTheme(id: AppThemeId): ThemeId {
	return APP_TO_TERMINAL_THEME[id];
}

function loadAppCustomTheme(): AppThemeColors {
	try {
		const parsed = readStoredJson<Partial<AppThemeColors> | null>(
			APP_CUSTOM_THEME_KEY,
			null
		);
		if (parsed && typeof parsed.black === "string")
			return { ...DEFAULT_COLORS, ...parsed };
	} catch {}
	return { ...DEFAULT_COLORS };
}

function getAppThemeById(id: AppThemeId): AppTheme {
	if (id === "custom") {
		return { id: "custom", name: "Custom", colors: loadAppCustomTheme() };
	}
	return APP_THEMES.find(hasId.bind(null, id)) ?? DEFAULT_THEME;
}

export function applyAppTheme(id: AppThemeId): void {
	const root = document.documentElement;
	const meta = document.querySelector('meta[name="theme-color"]');
	const theme = getAppThemeById(id);
	for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
		const value = theme.colors[key as keyof AppThemeColors];
		root.style.setProperty(cssVar, value);
	}
	root.style.setProperty(
		ACCENT_FOREGROUND_CSS_VAR,
		getReadableForeground(theme.colors.accent)
	);
	const light =
		id === "custom"
			? isLightColor(theme.colors.black)
			: APP_THEMES.find(hasId.bind(null, id))?.light;
	const depthTokens = light ? LIGHT_DEPTH_TOKENS : DARK_DEPTH_TOKENS;
	for (const [key, value] of Object.entries(depthTokens)) {
		root.style.setProperty(key, value);
	}
	root.style.colorScheme = light ? "light" : "dark";
	meta?.setAttribute("content", theme.colors.black);
}

function isLightColor(hex: string): boolean {
	const clean = hex.replace("#", "");
	const r = parseInt(clean.substring(0, 2), 16);
	const g = parseInt(clean.substring(2, 4), 16);
	const b = parseInt(clean.substring(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

function getReadableForeground(hex: string): string {
	return isLightColor(hex) ? "#111111" : "#f8f8f8";
}
