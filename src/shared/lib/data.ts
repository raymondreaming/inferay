export function isString(value: unknown): value is string {
	return typeof value === "string";
}
export function isActive(value: { active: boolean }): boolean {
	return value.active;
}
export function isBuiltIn(value: { isBuiltIn: boolean }): boolean {
	return value.isBuiltIn;
}
export function incrementNumber(value: number): number {
	return value + 1;
}
export function toggleBoolean(value: boolean): boolean {
	return !value;
}
export function noop(): void {}
export function contentOf<T extends { content: string }>(item: T): string {
	return item.content;
}
export function hasId(id: unknown, item: { id: string }): boolean {
	return item.id === id;
}
export function hasPath(path: unknown, item: { path: string }): boolean {
	return item.path === path;
}
export function lacksValue<T>(value: T, item: T): boolean {
	return item !== value;
}

export function basename(value: string): string {
	return value.split("/").pop() || value;
}
export function formatElapsedMs(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 1) return `${seconds}s`;
	const hours = Math.floor(minutes / 60);
	if (hours < 1) return `${minutes}m ${seconds}s`;
	return `${hours}h ${minutes % 60}m`;
}
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/** Prepared native Markdown wire model. Parsing belongs to the Rust server. */
export interface MdBlock {
	type:
		| "heading"
		| "code"
		| "mermaid"
		| "blockquote"
		| "hr"
		| "table"
		| "ul"
		| "ol"
		| "checklist"
		| "paragraph";
	content: string;
	tokens?: MdInlineToken[];
	level?: number;
	lang?: string;
	rows?: MdInlineToken[][][];
	items?: MdListItem[];
	children?: MdBlock[];
}
export interface MdListItem {
	bullet?: string;
	tokens: MdInlineToken[];
	checked?: boolean;
	indent: number;
}
export interface MdInlineToken {
	type:
		| "text"
		| "bold"
		| "italic"
		| "bold-italic"
		| "strikethrough"
		| "code"
		| "link"
		| "image"
		| "linebreak"
		| "markdown_path"
		| "url";
	text: string;
	href?: string;
	alt?: string;
	children?: MdInlineToken[];
}
export interface PreparedMarkdown {
	version: 1;
	blocks: MdBlock[];
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

export function trackPointerResize(
	pointerId: number,
	onMove: (event: PointerEvent) => void,
	onEnd: () => void = noop,
) {
	const release = lockPointerSelection();
	const move = (event: PointerEvent) => {
		if (event.pointerId === pointerId) onMove(event);
	};
	const end = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return;
		for (const stop of cleanup) stop();
		release();
		onEnd();
	};
	const cleanup = [
		listenWindowEvent("pointermove", move),
		listenWindowEvent("pointerup", end),
		listenWindowEvent("pointercancel", end),
	];
}

import { QueryClient } from "@octanejs/tanstack-query";
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
export function stopPropagation(event: Event): void {
	event.stopPropagation();
}
export function activateOnEnterOrSpacePreventDefault(
	action: () => void,
	event: KeyboardEvent,
): void {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	action();
}
export function setInputValue(
	setValue: (value: string) => void,
	event: InputEvent & {
		currentTarget: HTMLInputElement | HTMLTextAreaElement;
	},
): void {
	setValue(event.currentTarget.value);
}
export function setupAgentThemePanelShortcut(
	setShowSettings: (show: boolean) => void,
): () => void {
	return listenWindowEvent(
		"agent-open-theme-panel",
		setShowSettings.bind(null, true),
	);
}
export interface DotMatrixLoaderProps {
	dotSize?: number;
	gap?: number;
	speed?: number;
	ariaLabel?: string;
}
export interface DropdownOption {
	id: string;
	label: string;
	detail?: string;
	status?: string;
	icon?: unknown;
}
export type DropdownOptionRenderer =
	| ((props: { option: DropdownOption; isSelected: boolean }) => unknown)
	| ((option: DropdownOption, isSelected: boolean) => unknown);
export function selectDropdownOption(
	onChange: (id: string) => void,
	setOpen: (v: boolean) => void,
	id: string,
) {
	onChange(id);
	setOpen(false);
}

export function dispatchWindowEvent<T>(name: string, detail: T): void {
	window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}
