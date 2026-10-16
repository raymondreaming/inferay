import type {
	AppBackgroundMode,
	AppBackgroundSettings,
	AppearanceCatalog,
	AppFontId,
	BackgroundModel,
} from "@contracts";
import { createExternalSignal, listenWindowEvent } from "@shared/lib/dom.tsx";
import {
	APP_BACKGROUND_STORAGE_KEY,
	APP_FONT_STORAGE_KEY,
	CLIENT_STORAGE_CHANGED_EVENT,
	readStoredJson,
	readStoredValue,
	project as rustProject,
	writeStoredJson,
	writeStoredValue,
} from "@shared/lib/native.tsx";
import { createEffect, createMemo, onSettled } from "solid-js";
import appearanceCatalog from "../../../../build/presentation/appearance-catalog.json";

const catalog = appearanceCatalog as AppearanceCatalog;
declare global {
	interface Window {
		inferayNativeGlass?: boolean;
		ipc?: { postMessage: (message: string) => void };
	}
}
export const usesNativeGlass =
	typeof window !== "undefined" && window.inferayNativeGlass === true;
const APP_BACKGROUNDS = catalog.backgrounds;
export const APP_FONTS = catalog.fonts;
const DEFAULT_APP_BACKGROUND_SETTINGS = catalog.defaultBackground;

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
function saveAppBackgroundSettings(settings: AppBackgroundSettings): void {
	applyAppBackgroundSurfaces(settings.mode);
	writeStoredJson(APP_BACKGROUND_STORAGE_KEY, settings);
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
	return createMemo(() =>
		rustProject<BackgroundModel>("backgroundModel", {
			stored:
				stored() === null
					? DEFAULT_APP_BACKGROUND_SETTINGS
					: loadAppBackgroundSettings(),
		}),
	);
}
export function updateAppBackground(patch: Partial<AppBackgroundSettings>) {
	const model = rustProject<BackgroundModel>("backgroundModel", {
		stored: loadAppBackgroundSettings(),
		patch,
	});
	saveAppBackgroundSettings(model.background);
}
export function useAppAppearance() {
	const source = useBackgroundModel();
	createEffect(
		() =>
			source().background.mode === "glass"
				? source().background.glassOpacity / 100
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
	createEffect(() => source().background.mode, applyAppBackgroundSurfaces);
	createEffect(
		() => {
			const { background } = source();
			return background.autoTheme &&
				APP_BACKGROUNDS.some((scene) => scene.id === background.id)
				? background.id
				: null;
		},
		(scene) => {
			if (scene) document.documentElement.dataset.inferayScene = scene;
			else delete document.documentElement.dataset.inferayScene;
		},
	);
	return {
		get background() {
			return source().background;
		},
		get backgroundUrl() {
			return source().backgroundUrl;
		},
	};
}
