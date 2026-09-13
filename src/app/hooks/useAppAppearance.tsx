import type {
	AppBackgroundId,
	AppBackgroundMode,
	AppBackgroundSettings,
	AppearanceCatalog,
	AppFontId,
	AppThemeId,
	BackgroundModel,
} from "@contracts";
import { createExternalSignal, listenWindowEvent } from "@shared/lib/dom.tsx";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_FONT_STORAGE_KEY,
	APP_THEME_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
	readStoredJson,
	readStoredValue,
	project as rustProject,
	writeStoredJson,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { createEffect, createMemo, onSettled } from "solid-js";
import appearanceCatalog from "../../../build/presentation/appearance-catalog.json";

const catalog = appearanceCatalog as AppearanceCatalog;
declare global {
	interface Window {
		inferayNativeGlass?: boolean;
		ipc?: { postMessage: (message: string) => void };
	}
}
export const usesNativeGlass =
	typeof window !== "undefined" && window.inferayNativeGlass === true;
export const APP_THEMES = catalog.themes;
export const APP_BACKGROUNDS = catalog.backgrounds;
export const APP_FONTS = catalog.fonts;
export const DEFAULT_APP_BACKGROUND_SETTINGS = catalog.defaultBackground;
// Native window dragging uses these class names.
export const APP_REGION_DRAG_CLASS = "electrobun-webkit-app-region-drag";
export const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";
export const getThemeById = (id: string) =>
	(APP_THEMES.find((theme) => theme.id === id) ?? APP_THEMES[0]).theme;
export function loadAppThemeId(): AppThemeId {
	return "default";
}
export function saveAppThemeId(id: AppThemeId): void {
	writeStoredValue(APP_THEME_STORAGE_KEY, id);
}
export function applyAppTheme(id: AppThemeId): void {
	const root = document.documentElement;
	delete root.dataset.inferayScene;
	root.dataset.inferayTheme = id;
}
export function applyAppBackgroundSurfaces(mode: AppBackgroundMode): void {
	const root = document.documentElement;
	if (root.dataset.inferayBackground !== mode)
		root.dataset.inferayBackground = mode;
}
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
export function applyAppBackgroundPalette(
	id: AppBackgroundId,
	themeId = loadAppThemeId(),
): void {
	applyAppTheme(themeId);
	if (APP_BACKGROUNDS.some((background) => background.id === id)) {
		document.documentElement.dataset.inferayScene = id;
	}
}
export function restoreAppTheme(): void {
	applyAppTheme(loadAppThemeId());
}
export function loadAppFontId(): AppFontId {
	const stored = readStoredValue(APP_FONT_STORAGE_KEY);
	return APP_FONTS.find((font) => font.id === stored)?.id ?? "vscode";
}
export function applyAppFont(id: AppFontId): void {
	const selected = APP_FONTS.find((font) => font.id === id) ?? APP_FONTS[0];
	const root = document.documentElement;
	root.style.setProperty("--font-sans", selected.family);
	root.style.setProperty(
		"--font-mono",
		selected.editorFamily ?? selected.family,
	);
	root.style.setProperty(
		"--font-diff",
		selected.editorFamily ?? selected.family,
	);
}
export function saveAppFontId(id: AppFontId): void {
	writeStoredValue(APP_FONT_STORAGE_KEY, id);
}
const subscribeAppearance = (notify: () => void) =>
	listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, notify);
const readBackground = () => readStoredValue(APP_BACKGROUND_STORAGE_KEY);
export function useBackgroundModel() {
	const stored = createExternalSignal(subscribeAppearance, readBackground);
	const themeId = createExternalSignal(subscribeAppearance, loadAppThemeId);
	return createMemo(() =>
		rustProject<BackgroundModel>("backgroundModel", {
			stored:
				stored() === null
					? DEFAULT_APP_BACKGROUND_SETTINGS
					: loadAppBackgroundSettings(),
			themeId: themeId(),
		}),
	);
}
export function updateAppBackground(patch: Partial<AppBackgroundSettings>) {
	const model = rustProject<BackgroundModel>("backgroundModel", {
		stored: loadAppBackgroundSettings(),
		themeId: loadAppThemeId(),
		patch,
	});
	if (model.themeId !== loadAppThemeId()) saveAppThemeId(model.themeId);
	saveAppBackgroundSettings(model.background);
}
export function useAppAppearance() {
	const _source = useBackgroundModel();
	createEffect(
		() =>
			_source().background.mode === "glass"
				? _source().background.glassOpacity / 100
				: 0,
		(opacity) => {
			if (usesNativeGlass)
				window.ipc?.postMessage(`window_backdrop:${opacity}`);
		},
	);
	onSettled(() => {
		return listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
			if (
				(
					event as CustomEvent<{
						key?: string;
					}>
				).detail?.key === APP_FONT_STORAGE_KEY
			)
				applyAppFont(loadAppFontId());
		});
	});
	createEffect(() => _source().background.mode, applyAppBackgroundSurfaces);
	const palette = createMemo(
		() => {
			const model = _source();
			return {
				themeId: model.themeId,
				sceneId: model.background.autoTheme ? model.background.id : null,
			};
		},
		{
			equals: (previous, next) =>
				previous.themeId === next.themeId && previous.sceneId === next.sceneId,
		},
	);
	createEffect(palette, ({ themeId, sceneId }) => {
		if (sceneId) applyAppBackgroundPalette(sceneId, themeId);
		else applyAppTheme(themeId);
	});
	return {
		get background() {
			const _sourceValue3 = _source();
			return _sourceValue3.background;
		},
		get backgroundUrl() {
			const _sourceValue3 = _source();
			return _sourceValue3.backgroundUrl;
		},
	};
}
