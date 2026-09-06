import { useQuery } from "@octanejs/tanstack-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { sendJson } from "../../adapters/backend/http.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../adapters/storage/stored-values.ts";
import {
	dispatchWindowEvent,
	listenWindowEvent,
	queryClient,
} from "../lib/data.ts";

/** Query lifecycle only: native code owns all syntax interpretation. Kinds are
 *  a closed vocabulary the stylesheet colours, so one classification serves
 *  every theme and the client never ships a grammar. */
export type SyntaxKind =
	| "attribute"
	| "comment"
	| "constant"
	| "function"
	| "keyword"
	| "number"
	| "operator"
	| "plain"
	| "punctuation"
	| "string"
	| "tag"
	| "type";

export interface SyntaxToken {
	text: string;
	kind: SyntaxKind;
}

/** Beyond this the classification costs more than the colour is worth, and the
 *  native side declines it anyway. */
const MAX_HIGHLIGHT_CHARS = 2_000_000;
const MAX_HIGHLIGHT_LINES = 50_000;
const MAX_HIGHLIGHT_LINE_CHARS = 4_000;

export function shouldDisableSnippetHighlighting(lines: string[]): boolean {
	if (lines.length > MAX_HIGHLIGHT_LINES) return true;
	let total = 0;
	for (const line of lines) {
		if (line.length > MAX_HIGHLIGHT_LINE_CHARS) return true;
		total += line.length;
		if (total > MAX_HIGHLIGHT_CHARS) return true;
	}
	return false;
}

/** Identify content without retaining it: the query key must not hold a copy of
 *  every open document. */
function contentKey(lines: string[]): string {
	let hash = 2166136261;
	let length = 0;
	for (const line of lines) {
		length += line.length;
		for (let i = 0; i < line.length; i++) {
			hash = Math.imul(hash ^ line.charCodeAt(i), 16777619);
		}
		hash = Math.imul(hash ^ 10, 16777619);
	}
	return `${lines.length}:${length}:${hash >>> 0}`;
}

interface ClassifiedDocument {
	version: number;
	language: string;
	lines: Array<Array<number | string>>;
}

export function useSyntaxHighlight({
	filePath,
	lines,
	enabled = true,
}: {
	filePath: string;
	lines: string[];
	enabled?: boolean;
}) {
	const active = enabled && !shouldDisableSnippetHighlighting(lines);
	const key = useMemo(
		() => (active ? contentKey(lines) : String(lines.length)),
		[active, lines],
	);
	const linesRef = useRef(lines);
	linesRef.current = lines;
	const query = useQuery(
		{
			queryKey: ["syntax", 1, filePath, key],
			enabled: active && lines.length > 0,
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				const response = await sendJson(
					"/api/native/highlight",
					{ path: filePath, text: linesRef.current.join("\n") },
					{ signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) },
				);
				if (!response.ok) throw new Error("Highlight request failed");
				const document: ClassifiedDocument | null = await response.json();
				return document?.version === 1 ? document : null;
			},
			staleTime: Infinity,
			gcTime: 60_000,
			retry: false,
		},
		queryClient,
	);
	// Slicing every line up front wastes the work virtualization exists to
	// avoid, so tokens are cut on demand and kept per document.
	const tokens = useRef(new Map<number, SyntaxToken[]>());
	const document = query.data ?? null;
	const documentRef = useRef(document);
	if (documentRef.current !== document) {
		documentRef.current = document;
		tokens.current = new Map();
	}
	const getLineTokens = useCallback(
		(index: number): SyntaxToken[] | undefined => {
			const runs = documentRef.current?.lines[index];
			const text = linesRef.current[index];
			if (!runs || text === undefined) return undefined;
			const cached = tokens.current.get(index);
			if (cached) return cached;
			const cut: SyntaxToken[] = [];
			let offset = 0;
			for (let i = 0; i + 1 < runs.length; i += 2) {
				const length = runs[i] as number;
				cut.push({
					text: text.slice(offset, offset + length),
					kind: runs[i + 1] as SyntaxKind,
				});
				offset += length;
			}
			// A trailing remainder means the grammar stopped early; show it plain
			// rather than dropping characters the reader can see in the source.
			if (offset < text.length)
				cut.push({ text: text.slice(offset), kind: "plain" });
			tokens.current.set(index, cut);
			return cut;
		},
		[],
	);
	return {
		getLineTokens,
		isReady: !active || !query.isPending,
		language: document?.language ?? null,
	};
}

export const SYNTAX_HIGHLIGHT_THEMES = [
	{ id: "contrast", label: "High Contrast" },
	{ id: "vitesse", label: "Vitesse" },
	{ id: "one-dark", label: "One Dark" },
	{ id: "dracula", label: "Dracula" },
	{ id: "slack", label: "Slack" },
] as const;

export type SyntaxHighlightTheme =
	(typeof SYNTAX_HIGHLIGHT_THEMES)[number]["id"];
export const DEFAULT_SYNTAX_HIGHLIGHT_THEME: SyntaxHighlightTheme = "contrast";

const SYNTAX_THEME_STORAGE_KEY = "inferay-syntax-highlight-theme";
const SYNTAX_THEME_EVENT = "inferay-syntax-highlight-theme-change";

function normalize(value: string | null): SyntaxHighlightTheme {
	return (
		SYNTAX_HIGHLIGHT_THEMES.find((entry) => entry.id === value)?.id ??
		DEFAULT_SYNTAX_HIGHLIGHT_THEME
	);
}

/** The palette is a stylesheet concern, so applying a theme only swaps the
 *  attribute the `--color-syntax-*` variables key off. */
export function applySyntaxTheme(theme: SyntaxHighlightTheme): void {
	document.documentElement.dataset.inferaySyntaxTheme = theme;
}

export function useSyntaxHighlightTheme() {
	const [theme, setTheme] = useState(() =>
		normalize(readStoredValue(SYNTAX_THEME_STORAGE_KEY)),
	);
	useEffect(
		() =>
			listenWindowEvent(SYNTAX_THEME_EVENT, (event: Event) =>
				setTheme(normalize((event as CustomEvent<string>).detail ?? null)),
			),
		[],
	);
	const select = useCallback((next: SyntaxHighlightTheme) => {
		const resolved = normalize(next);
		setTheme(resolved);
		applySyntaxTheme(resolved);
		writeStoredValue(SYNTAX_THEME_STORAGE_KEY, resolved);
		dispatchWindowEvent(SYNTAX_THEME_EVENT, resolved);
	}, []);
	return [theme, select] as const;
}

export function restoreSyntaxTheme(): void {
	applySyntaxTheme(normalize(readStoredValue(SYNTAX_THEME_STORAGE_KEY)));
}
