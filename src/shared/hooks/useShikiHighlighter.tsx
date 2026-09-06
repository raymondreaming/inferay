import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import type { BundledLanguage, BundledTheme } from "shiki";
import { dispatchWindowEvent, incrementNumber } from "../lib/data.ts";
import { requestHighlight } from "../lib/highlight-client.ts";

// Map file extensions to Shiki language IDs
const EXTENSION_TO_LANG: Record<string, BundledLanguage> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	json: "json",
	md: "markdown",
	css: "css",
	scss: "scss",
	html: "html",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	sql: "sql",
	graphql: "graphql",
	vue: "vue",
	svelte: "svelte",
	php: "php",
	lua: "lua",
	r: "r",
	scala: "scala",
	dart: "dart",
	zig: "zig",
};

export type SyntaxHighlightTheme = BundledTheme;
export interface ShikiLineToken {
	bgColor?: string;
	color?: string;
	content: string;
}

export const DEFAULT_SYNTAX_HIGHLIGHT_THEME: SyntaxHighlightTheme =
	"github-dark-high-contrast";

export const SYNTAX_HIGHLIGHT_THEMES: {
	id: SyntaxHighlightTheme;
	label: string;
}[] = [
	{ id: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
	{ id: "vitesse-dark", label: "Vitesse Dark" },
	{ id: "one-dark-pro", label: "One Dark" },
	{ id: "dracula", label: "Dracula" },
	{ id: "slack-dark", label: "Slack Dark" },
];

const SYNTAX_THEME_STORAGE_KEY = "inferay-syntax-highlight-theme" as const;
const SYNTAX_THEME_EVENT = "inferay-syntax-highlight-theme-change" as const;
const EMPTY_HIGHLIGHTS = new Map<number, string>();
const MAX_CACHED_HIGHLIGHT_LINES = 2_000;
const HIGHLIGHT_CACHE_RANGE_PADDING = 500;
const MAX_SNIPPET_HIGHLIGHT_LINES = 2_000;
const MAX_SNIPPET_HIGHLIGHT_CHARS = 120_000;
const MAX_SNIPPET_HIGHLIGHT_LINE_CHARS = 4_000;

export function shouldDisableSnippetHighlighting(lines: string[]): boolean {
	if (lines.length > MAX_SNIPPET_HIGHLIGHT_LINES) return true;
	let totalChars = 0;
	for (const line of lines) {
		if (line.length > MAX_SNIPPET_HIGHLIGHT_LINE_CHARS) return true;
		totalChars += line.length;
		if (totalChars > MAX_SNIPPET_HIGHLIGHT_CHARS) return true;
	}
	return false;
}

function pruneHighlightCache<T>(
	cache: Map<number, T>,
	visibleStart: number,
	visibleEnd: number,
) {
	if (cache.size <= MAX_CACHED_HIGHLIGHT_LINES) return;
	const keepStart = Math.max(0, visibleStart - HIGHLIGHT_CACHE_RANGE_PADDING);
	const keepEnd = visibleEnd + HIGHLIGHT_CACHE_RANGE_PADDING;
	for (const lineIndex of cache.keys()) {
		if (lineIndex < keepStart || lineIndex > keepEnd) cache.delete(lineIndex);
	}
	if (cache.size <= MAX_CACHED_HIGHLIGHT_LINES) return;
	for (const lineIndex of cache.keys()) {
		cache.delete(lineIndex);
		if (cache.size <= MAX_CACHED_HIGHLIGHT_LINES) break;
	}
}
function createLineContentKey(lines: string[]): string {
	let hash = 2166136261;
	let totalLength = 0;
	for (const line of lines) {
		totalLength += line.length;
		for (let i = 0; i < line.length; i++) {
			hash ^= line.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		hash ^= 10;
		hash = Math.imul(hash, 16777619);
	}
	return `${lines.length}:${totalLength}:${hash >>> 0}`;
}

function normalizeSyntaxTheme(theme: string | null): SyntaxHighlightTheme {
	return (
		SYNTAX_HIGHLIGHT_THEMES.find((entry) => entry.id === theme)?.id ??
		DEFAULT_SYNTAX_HIGHLIGHT_THEME
	);
}

function readSyntaxTheme(): SyntaxHighlightTheme {
	if (typeof window === "undefined") return DEFAULT_SYNTAX_HIGHLIGHT_THEME;
	try {
		return normalizeSyntaxTheme(
			window.localStorage.getItem(SYNTAX_THEME_STORAGE_KEY),
		);
	} catch {
		return DEFAULT_SYNTAX_HIGHLIGHT_THEME;
	}
}

export function useSyntaxHighlightTheme() {
	const [theme, setThemeState] =
		useState<SyntaxHighlightTheme>(readSyntaxTheme);

	useEffect(() => {
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== SYNTAX_THEME_STORAGE_KEY) return;
			setThemeState(normalizeSyntaxTheme(event.newValue));
		};
		const handleThemeChange = (event: Event) => {
			setThemeState(
				normalizeSyntaxTheme((event as CustomEvent<string>).detail ?? null),
			);
		};

		window.addEventListener("storage", handleStorage);
		window.addEventListener(SYNTAX_THEME_EVENT, handleThemeChange);
		return () => {
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener(SYNTAX_THEME_EVENT, handleThemeChange);
		};
	}, []);

	const setTheme = useCallback((nextTheme: SyntaxHighlightTheme) => {
		const normalized = normalizeSyntaxTheme(nextTheme);
		setThemeState(normalized);
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(SYNTAX_THEME_STORAGE_KEY, normalized);
		} catch {}
		dispatchWindowEvent(SYNTAX_THEME_EVENT, normalized);
	}, []);

	return [theme, setTheme] as const;
}

function getLanguageFromPath(filePath: string): BundledLanguage | null {
	const ext = filePath.split(".").pop()?.toLowerCase();
	if (!ext) return null;
	return EXTENSION_TO_LANG[ext] ?? null;
}

export interface UseShikiHighlighterOptions {
	filePath: string;
	lines: string[];
	visibleRange: [number, number];
	theme?: BundledTheme;
	enabled?: boolean;
}

export interface ShikiHighlighterAPI {
	ensureHighlightedRange: (start: number, end: number) => boolean;
	getHighlightedLineTokens: (lineIdx: number) => ShikiLineToken[] | undefined;
	isReady: boolean;
	language: string | null;
	revision: number;
}

export function useShikiHighlighter({
	filePath,
	lines,
	visibleRange,
	theme = DEFAULT_SYNTAX_HIGHLIGHT_THEME,
	enabled = true,
}: UseShikiHighlighterOptions): ShikiHighlighterAPI {
	const language = getLanguageFromPath(filePath);
	const lineContentKey = useMemo(
		() => (enabled ? createLineContentKey(lines) : String(lines.length)),
		[enabled, lines],
	);
	const key = `${enabled}\0${filePath}\0${language ?? ""}\0${theme}\0${lineContentKey}`;
	const [revision, setRevision] = useState(0);
	const cacheRef = useRef({ key, tokens: new Map<number, ShikiLineToken[]>() });
	if (cacheRef.current.key !== key)
		cacheRef.current = { key, tokens: new Map() };
	const activeRef = useRef<AbortController | null>(null);
	const linesRef = useRef(lines);
	linesRef.current = lines;
	const ensureHighlightedRange = useCallback(
		(start: number, end: number) => {
			if (!enabled || !language) return false;
			const cache = cacheRef.current;
			let missing = false;
			for (let i = start; i <= end && i < linesRef.current.length; i++) {
				if (!cache.tokens.has(i)) {
					missing = true;
					break;
				}
			}
			if (!missing) return true;
			activeRef.current?.abort();
			const controller = new AbortController();
			activeRef.current = controller;
			void requestHighlight(
				key,
				linesRef.current,
				language,
				theme,
				start,
				end,
				controller.signal,
			)
				.then((rows) => {
					if (controller.signal.aborted || cacheRef.current !== cache) return;
					for (const [index, tokens] of rows) cache.tokens.set(index, tokens);
					pruneHighlightCache(cache.tokens, start, end);
					if (rows.length) setRevision(incrementNumber);
				})
				.catch(() => {
					/* Plain text remains usable if highlighting fails. */
				});
			return false;
		},
		[enabled, key, language, theme],
	);
	useEffect(() => {
		ensureHighlightedRange(visibleRange[0], visibleRange[1]);
		return () => activeRef.current?.abort();
	}, [ensureHighlightedRange, visibleRange[0], visibleRange[1]]);
	const getHighlightedLineTokens = useCallback(
		(index: number) => cacheRef.current.tokens.get(index),
		[],
	);
	return {
		ensureHighlightedRange,
		getHighlightedLineTokens,
		isReady: true,
		language,
		revision,
	};
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}
export function useShikiSnippet(
	lines: string[],
	filePath: string,
	enabled = true,
	theme: SyntaxHighlightTheme = DEFAULT_SYNTAX_HIGHLIGHT_THEME,
): { highlighted: Map<number, string>; isReady: boolean } {
	const language = getLanguageFromPath(filePath);
	const highlightEnabled = useMemo(
		() => enabled && !!language && !shouldDisableSnippetHighlighting(lines),
		[enabled, language, lines],
	);
	const linesHash = useMemo(
		() =>
			highlightEnabled
				? createLineContentKey(lines)
				: `${lines.length}:highlight-disabled`,
		[highlightEnabled, lines],
	);
	const snippetKey = `${highlightEnabled}\0${filePath}\0${language ?? ""}\0${theme}\0${linesHash}`;
	const [highlightedState, setHighlightedState] = useState<{
		key: string;
		highlighted: Map<number, string>;
	} | null>(null);
	const linesRef = useRef<string[]>([]);

	const isReady =
		!highlightEnabled ||
		lines.length === 0 ||
		highlightedState?.key === snippetKey;
	const highlighted =
		highlightedState?.key === snippetKey
			? highlightedState.highlighted
			: EMPTY_HIGHLIGHTS;

	useEffect(() => {
		// Only re-highlight if lines actually changed
		const linesChanged =
			lines.length !== linesRef.current.length ||
			lines.some((l, i) => l !== linesRef.current[i]);

		if (!linesChanged && isReady) return;
		linesRef.current = lines;

		if (!highlightEnabled || !language || lines.length === 0) return;
		const resolvedLanguage = language;

		const controller = new AbortController();
		const { signal } = controller;

		async function highlight() {
			try {
				const rows = await requestHighlight(
					snippetKey,
					lines,
					resolvedLanguage,
					theme,
					0,
					lines.length - 1,
					signal,
				);
				const result = new Map(
					rows.map(([index, tokens]) => [
						index,
						tokens
							.map(
								(token) =>
									`<span style="color:${token.color ?? "inherit"}">${escapeHtml(token.content)}</span>`,
							)
							.join(""),
					]),
				);

				if (!signal.aborted) {
					setHighlightedState({ key: snippetKey, highlighted: result });
				}
			} catch {
				if (!signal.aborted) {
					setHighlightedState({
						key: snippetKey,
						highlighted: EMPTY_HIGHLIGHTS,
					});
				}
			}
		}

		highlight();

		return controller.abort.bind(controller);
	}, [lines, language, highlightEnabled, isReady, snippetKey, theme]);

	return { highlighted, isReady };
}
