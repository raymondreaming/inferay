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
export interface IndexedValue<T> {
	index: number;
	value: T;
}

/**
 * Keeps a render-list index on the item object. This avoids compiler-generated
 * JSX key functions closing over a map callback's second parameter.
 */
export function indexedValues<T>(values: readonly T[]): IndexedValue<T>[] {
	return values.map((value, index) => ({
		index,
		value,
	}));
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
	content: string;
	tokens: MdInlineToken[];
	checked?: boolean;
	indent: number;
	children: MdListItem[];
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
export type TokenType =
	| "keyword"
	| "string"
	| "comment"
	| "number"
	| "punctuation"
	| "tag"
	| "attr"
	| "default";
export interface Token {
	text: string;
	type: TokenType;
}
const keywords = {
	js: new Set(
		`import export from default const let var function return if else for while do
switch case break continue new delete typeof instanceof in of class extends
super this async await yield throw try catch finally true false null undefined
void as type interface enum implements static readonly private public
protected abstract declare module namespace`.split(/\s+/),
	),
	py: new Set(
		`import from def class return if elif else for while break continue pass raise
try except finally with as lambda yield True False None and or not in is del
global nonlocal assert async await self`.split(/\s+/),
	),
	rust: new Set(
		`fn let mut const static struct enum impl trait type pub mod use crate super
self if else match for while loop break continue return async await move where
true false Some None Ok Err Self`.split(/\s+/),
	),
	go: new Set(
		`package import func return if else for range switch case default break
continue go defer chan select struct interface type map var const true false
nil make new append len cap delete copy`.split(/\s+/),
	),
};

// Sticky expressions consume one complete token at the current cursor.
// Rule order preserves comments, quoted strings, and tags before identifiers.
const rules: Array<[TokenType, RegExp, ((ext: string) => boolean)?]> = [
	["comment", /\/\/[\s\S]*|\/\*[\s\S]*?(?:\*\/|$)/y],
	["comment", /#[\s\S]*/y, (ext) => !["css", "scss", "less"].includes(ext)],
	[
		"string",
		/"(?:\\[\s\S]?|[^"\\])*"?|'(?:\\[\s\S]?|[^'\\])*'?|`(?:\\[\s\S]?|[^`\\])*`?/y,
	],
	["number", /(?<!\w)\d[\d.xXa-fA-Fe_]*/y],
	[
		"tag",
		/<\/?[\w-]+/y,
		(ext) => ["html", "htm", "xml", "svg", "jsx", "tsx"].includes(ext),
	],
	["keyword", /[a-zA-Z_$][\w$]*/y],
	["punctuation", /[{}()[\];:,.<>!=+\-*/%&|^~?@]/y],
	["default", /[^a-zA-Z_$@0-9"'`/{}()[\];:,.<>!=+\-*/%&|^~?#]+|[\s\S]/y],
];
export function tokenizeLine(line: string, ext: string): Token[] {
	if (!line)
		return [
			{
				text: line,
				type: "default",
			},
		];
	const vocabulary =
		ext === "py"
			? keywords.py
			: ext === "rs"
				? keywords.rust
				: ext === "go"
					? keywords.go
					: keywords.js;
	const activeRules = rules.filter(([, , accepts]) => !accepts || accepts(ext));
	const tokens: Token[] = [];
	for (let cursor = 0; cursor < line.length; ) {
		for (const [kind, expression] of activeRules) {
			expression.lastIndex = cursor;
			const match = expression.exec(line);
			if (!match) continue;
			const text = match[0];
			tokens.push({
				text,
				type: kind === "keyword" && !vocabulary.has(text) ? "default" : kind,
			});
			cursor += text.length;
			break;
		}
	}
	return tokens;
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
