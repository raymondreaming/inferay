import type { JSX } from "@solidjs/web";
import type * as CSS from "csstype";
import { onSettled } from "solid-js";
export type CSSProperties = CSS.Properties<string | number> & {
	[key: `--${string}`]: string | number | undefined;
};
export type RefCell<T> = {
	current: T;
};
export type StateUpdate<T> = T | ((previous: T) => T);
export type Dispatch<T> = (value: T) => void;
const unitless = new Set([
	"animationIterationCount",
	"aspectRatio",
	"borderImageOutset",
	"borderImageSlice",
	"borderImageWidth",
	"columnCount",
	"fillOpacity",
	"flex",
	"flexGrow",
	"flexShrink",
	"fontWeight",
	"gridArea",
	"gridColumn",
	"gridColumnEnd",
	"gridColumnStart",
	"gridRow",
	"gridRowEnd",
	"gridRowStart",
	"lineHeight",
	"opacity",
	"order",
	"orphans",
	"scale",
	"stopOpacity",
	"strokeDasharray",
	"strokeDashoffset",
	"strokeMiterlimit",
	"strokeOpacity",
	"strokeWidth",
	"tabSize",
	"widows",
	"zIndex",
	"zoom",
]);
/** Normalize programmatic CSS values for Solid's native DOM style semantics. */
export function domStyle(
	style: CSSProperties | JSX.CSSProperties | string | null | undefined,
): JSX.CSSProperties | string | undefined {
	if (typeof style === "string" || !style) return style ?? undefined;
	const result: Record<string, string | number | undefined> = {};
	for (const [key, value] of Object.entries(style)) {
		const name = key.startsWith("--")
			? key
			: key
					.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
					.replace(/^ms-/, "-ms-");
		result[name] =
			typeof value === "number" &&
			value !== 0 &&
			!unitless.has(key) &&
			!key.startsWith("--")
				? `${value}px`
				: value;
	}
	return result as JSX.CSSProperties;
}

/** Forward a DOM or imperative handle to a callback or a locally owned ref cell. */
export function assignRef<T>(
	target: import("solid-js").Ref<T> | RefCell<T | null> | null,
	value: T,
): void {
	if (Array.isArray(target)) for (const ref of target) assignRef(ref, value);
	else if (typeof target === "function") (target as (value: T) => void)(value);
	else if (target && typeof target === "object" && "current" in target)
		target.current = value;
}
export function ariaValue<
	T extends string | number | boolean | null | undefined,
>(value: T): T extends boolean ? "true" | "false" : T {
	return (
		typeof value === "boolean" ? (value ? "true" : "false") : value
	) as T extends boolean ? "true" | "false" : T;
}

export function captureEvent<K extends keyof HTMLElementEventMap>(
	type: K,
	handler: (
		event: HTMLElementEventMap[K] & { currentTarget: HTMLDivElement },
	) => void,
) {
	let target: HTMLElement | undefined;
	onSettled(() => {
		const element = target;
		if (!element) return;
		const listener = (event: Event) =>
			handler(
				event as HTMLElementEventMap[K] & { currentTarget: HTMLDivElement },
			);
		element.addEventListener(type, listener, { capture: true });
		return () => element.removeEventListener(type, listener, { capture: true });
	});
	return (element: HTMLElement) => {
		target = element;
	};
}

import { type Accessor, createEffect, createSignal, untrack } from "solid-js";

/** Connect a durable native-backed store to the current Solid owner. */
export function createExternalSignal<T>(
	subscribe: (notify: () => void) => () => unknown,
	snapshot: () => T,
): Accessor<T> {
	const [value, setValue] = createSignal<T>(() => untrack(snapshot));
	onSettled(() => {
		const unsubscribe = subscribe(() => setValue(() => snapshot()));
		// Catch changes between the initial snapshot and subscription setup.
		setValue(() => snapshot());
		return unsubscribe;
	});
	return value;
}
export function createReducer<S, A>(
	reducer: (state: S, action: A) => S,
	initial: S,
): [Accessor<S>, (action: A) => void] {
	const [state, setState] = createSignal<S>(() => initial);
	return [state, (action) => setState((previous) => reducer(previous, action))];
}
export function bindImperativeRef<T>(
	ref: Accessor<import("solid-js").Ref<T | null> | { current: T | null }>,
	value: () => T,
) {
	createEffect(
		() => [ref(), value()] as const,
		([target, handle]) => {
			assignRef(target, handle);
			return () => assignRef(target, null);
		},
	);
}

import { writeStoredValue } from "./native.tsx";
export function noop(): void {}
export function hasId(
	id: unknown,
	item: {
		id: string;
	},
): boolean {
	return item.id === id;
}
export function basename(value: string): string {
	return value.split("/").pop() || value;
}
let activeLocks = 0;
const preventSelection = (event: Event) => event.preventDefault();
let restorePointerSelection = () => {};
export function lockPointerSelection(): () => void {
	if (activeLocks === 0) {
		const saved = [document.body, document.documentElement].flatMap(
			({ style }) =>
				["user-select", "-webkit-user-select"].map((property) => ({
					style,
					property,
					value: style.getPropertyValue(property),
					priority: style.getPropertyPriority(property),
				})),
		);
		for (const { style, property } of saved)
			style.setProperty(property, "none");
		restorePointerSelection = () => {
			for (const { style, property, value, priority } of saved)
				style.setProperty(property, value, priority);
		};
		document.addEventListener("selectstart", preventSelection, true);
		window.getSelection()?.removeAllRanges();
	}
	activeLocks++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--activeLocks === 0) {
			restorePointerSelection();
			document.removeEventListener("selectstart", preventSelection, true);
			window.getSelection()?.removeAllRanges();
		}
	};
}
/** Create during component setup so a disappearing pane cancels its drag. */
export function createPointerResize() {
	let cancel = noop;
	onSettled(() => () => cancel());
	return (...args: Parameters<typeof trackPointerResize>) => {
		cancel();
		cancel = trackPointerResize(...args);
		return cancel;
	};
}
export function trackPointerResize(
	pointerId: number,
	onMove: (event: PointerEvent) => void,
	onEnd: () => void = noop,
) {
	const release = lockPointerSelection();
	const move = (event: PointerEvent) => {
		if (event.pointerId === pointerId) onMove(event);
	};
	let disposed = false;
	const cancel = () => {
		if (disposed) return;
		disposed = true;
		for (const stop of cleanup) stop();
		release();
	};
	const end = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return;
		cancel();
		onEnd();
	};
	const cleanup = [
		listenWindowEvent("pointermove", move),
		listenWindowEvent("pointerup", end),
		listenWindowEvent("pointercancel", end),
		listenWindowEvent("blur", cancel),
	];
	return cancel;
}

import { QueryClient } from "@tanstack/solid-query";
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 15_000,
		},
	},
});
export function listenWindowEvent<K extends keyof WindowEventMap | string>(
	type: K,
	listener: K extends keyof WindowEventMap
		? (event: WindowEventMap[K]) => void
		: EventListenerOrEventListenerObject,
): () => void {
	const eventListener = listener as EventListenerOrEventListenerObject;
	window.addEventListener(type, eventListener);
	return window.removeEventListener.bind(
		window,
		type,
		eventListener,
	) as () => void;
}
export function setInputValue(
	setValue: (value: string) => void,
	event: InputEvent & {
		currentTarget: HTMLInputElement | HTMLTextAreaElement;
	},
): void {
	setValue(event.currentTarget.value);
}
export function dispatchWindowEvent<T>(name: string, detail: T): void {
	window.dispatchEvent(
		new CustomEvent<T>(name, {
			detail,
		}),
	);
}
export const OPEN_ACTIVE_GIT_GRAPH_EVENT = "inferay-open-active-git-graph";
export const TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT =
	"inferay-toggle-active-git-sidebar";
export function dispatchOpenActiveGitGraph(): void {
	window.dispatchEvent(new CustomEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT));
}
export function dispatchToggleActiveGitSidebar(): void {
	window.dispatchEvent(new CustomEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT));
}
export const OPEN_SETTINGS_MODAL_EVENT = "inferay-open-settings-modal";
export type SettingsModalTarget =
	| "agents"
	| "appearance"
	| "workspace"
	| "github";
export interface OpenSettingsModalDetail {
	readonly section: SettingsModalTarget;
}
export function openSettingsModal(
	section: SettingsModalTarget = "agents",
): void {
	dispatchWindowEvent<OpenSettingsModalDetail>(OPEN_SETTINGS_MODAL_EVENT, {
		section,
	});
}
export const OPEN_SKILLS_EVENT = "inferay-open-skills";
export type SkillsTarget =
	| {
			mode: "browse";
	  }
	| {
			mode: "create";
	  }
	| {
			mode: "edit";
			skillId: string;
	  };
export function openSkills(
	target: SkillsTarget = {
		mode: "browse",
	},
): void {
	dispatchWindowEvent(OPEN_SKILLS_EVENT, target);
}
export type MutableRef<T> = {
	current: T;
};
export const REMOVE_AGENT_PANE_REQUEST_EVENT =
	"inferay-remove-agent-pane-request";
export interface RemoveAgentPaneRequestDetail {
	paneId: string;
}
export const dispatchRemoveAgentPaneRequest = (paneId: string) =>
	dispatchWindowEvent<RemoveAgentPaneRequestDetail>(
		REMOVE_AGENT_PANE_REQUEST_EVENT,
		{
			paneId,
		},
	);
export const CREATE_AGENT_CHAT_EVENT = "create-agent-chat",
	FOCUS_AGENT_CHAT_COMPOSER_EVENT = "inferay-focus-agent-chat-composer";
export type CreateAgentChatTarget = "active-repository" | "new-repository";
export interface CreateAgentChatDetail {
	target: CreateAgentChatTarget;
}
export interface FocusAgentChatComposerDetail {
	paneId: string;
}
export const dispatchCreateAgentChat = (
	target: CreateAgentChatTarget = "active-repository",
) =>
	dispatchWindowEvent<CreateAgentChatDetail>(CREATE_AGENT_CHAT_EVENT, {
		target,
	});
export const dispatchFocusAgentChatComposer = (paneId: string) =>
	dispatchWindowEvent<FocusAgentChatComposerDetail>(
		FOCUS_AGENT_CHAT_COMPOSER_EVENT,
		{
			paneId,
		},
	);
export const WORKSPACE_SIDEBAR_COLLAPSED_EVENT =
	"inferay-workspace-sidebar-collapsed";
export interface WorkspaceSidebarCollapsedDetail {
	collapsed: boolean;
}
export function setWorkspaceSidebarCollapsed(collapsed: boolean) {
	writeStoredValue("sidebar-collapsed", String(collapsed));
	dispatchWindowEvent<WorkspaceSidebarCollapsedDetail>(
		WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
		{
			collapsed,
		},
	);
}
export const DOCUMENT_OPEN_EVENT = "workspace-file-open";
export type DocumentOpenDetail = {
	readonly cwd: string;
	readonly path: string;
};
export function dispatchDocumentOpen(detail: DocumentOpenDetail) {
	dispatchWindowEvent<DocumentOpenDetail>(DOCUMENT_OPEN_EVENT, detail);
}
