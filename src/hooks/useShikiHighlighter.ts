import { useCallback, useEffect, useRef, useState } from "react";
import type { BundledLanguage, BundledTheme, Highlighter } from "shiki";
import { incrementNumber } from "../lib/data.ts";

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

// Singleton highlighter instance — eagerly created at module load
let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>();
const loadedThemes = new Set<BundledTheme>(["github-dark-default"]);

export type SyntaxHighlightTheme = BundledTheme;

export const DEFAULT_SYNTAX_HIGHLIGHT_THEME: SyntaxHighlightTheme =
	"github-dark-default";

export const SYNTAX_HIGHLIGHT_THEMES: {
	id: SyntaxHighlightTheme;
	label: string;
}[] = [
	{ id: "github-dark-default", label: "GitHub Dark" },
	{ id: "vitesse-dark", label: "Vitesse Dark" },
	{ id: "one-dark-pro", label: "One Dark" },
	{ id: "dracula", label: "Dracula" },
	{ id: "slack-dark", label: "Slack Dark" },
];

const SYNTAX_THEME_STORAGE_KEY = "inferay-syntax-highlight-theme" as const;
const SYNTAX_THEME_EVENT = "inferay-syntax-highlight-theme-change" as const;

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
			window.localStorage.getItem(SYNTAX_THEME_STORAGE_KEY)
		);
	} catch {
		return DEFAULT_SYNTAX_HIGHLIGHT_THEME;
	}
}

export function saveSyntaxHighlightTheme(theme: SyntaxHighlightTheme) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(SYNTAX_THEME_STORAGE_KEY, theme);
	} catch {}
	window.dispatchEvent(new CustomEvent(SYNTAX_THEME_EVENT, { detail: theme }));
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
				normalizeSyntaxTheme((event as CustomEvent<string>).detail ?? null)
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
		saveSyntaxHighlightTheme(normalized);
	}, []);

	return [theme, setTheme] as const;
}

async function getHighlighter(): Promise<Highlighter> {
	if (highlighterInstance) return highlighterInstance;
	if (highlighterPromise) return highlighterPromise;

	highlighterPromise = import("shiki").then(({ createHighlighter }) =>
		createHighlighter({
			themes: ["github-dark-default"],
			langs: [], // Load languages on demand
		})
	);

	highlighterInstance = await highlighterPromise;
	return highlighterInstance;
}

async function ensureLanguage(hl: Highlighter, language: BundledLanguage) {
	if (loadedLanguages.has(language)) return;
	await hl.loadLanguage(language);
	loadedLanguages.add(language);
}

async function ensureTheme(hl: Highlighter, theme: SyntaxHighlightTheme) {
	if (loadedThemes.has(theme)) return;
	await hl.loadTheme(theme);
	loadedThemes.add(theme);
}

function highlightLine(
	hl: Highlighter,
	line: string,
	language: BundledLanguage,
	theme: BundledTheme
) {
	try {
		const html = hl.codeToHtml(line, { lang: language, theme });
		const match = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
		const innerHtml = match?.[1] ?? escapeHtml(line);
		return unwrapLineSpan(innerHtml) || escapeHtml(line);
	} catch {
		return escapeHtml(line);
	}
}

const HIGHLIGHT_CONTEXT_LINES = 200;
type IdleWindow = Window & {
	requestIdleCallback?: (
		callback: () => void,
		options?: { timeout?: number }
	) => number;
	cancelIdleCallback?: (handle: number) => void;
};

function scheduleHighlightWork(callback: () => void) {
	const win = window as IdleWindow;
	if (win.requestIdleCallback && win.cancelIdleCallback) {
		const handle = win.requestIdleCallback(callback, { timeout: 120 });
		return () => win.cancelIdleCallback?.(handle);
	}
	const handle = window.setTimeout(callback, 0);
	return () => window.clearTimeout(handle);
}

function highlightLineRange(
	hl: Highlighter,
	lines: string[],
	start: number,
	end: number,
	language: BundledLanguage,
	theme: BundledTheme
) {
	const from = Math.max(0, start - HIGHLIGHT_CONTEXT_LINES);
	const to = Math.min(lines.length - 1, end);
	if (to < start) return new Map<number, string>();

	try {
		const html = hl.codeToHtml(lines.slice(from, to + 1).join("\n"), {
			lang: language,
			theme,
		});
		const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
		const codeHtml = codeMatch?.[1] ?? "";
		const renderedLines = splitRenderedLines(codeHtml);
		const highlighted = new Map<number, string>();

		for (let lineIdx = start; lineIdx <= to; lineIdx++) {
			const rendered = renderedLines[lineIdx - from];
			highlighted.set(
				lineIdx,
				rendered != null
					? rendered || escapeHtml(lines[lineIdx] ?? "")
					: highlightLine(hl, lines[lineIdx] ?? "", language, theme)
			);
		}
		return highlighted;
	} catch {
		const highlighted = new Map<number, string>();
		for (let lineIdx = start; lineIdx <= to; lineIdx++) {
			highlighted.set(
				lineIdx,
				highlightLine(hl, lines[lineIdx] ?? "", language, theme)
			);
		}
		return highlighted;
	}
}

function splitRenderedLines(codeHtml: string) {
	const parts = codeHtml.split(LINE_SPAN_PREFIX).slice(1);
	return parts.map((part) => {
		const trimmed = part.trimEnd();
		return trimmed.endsWith(SPAN_CLOSE)
			? trimmed.slice(0, -SPAN_CLOSE.length)
			: trimmed;
	});
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
	getHighlightedLine: (lineIdx: number) => string | undefined;
	isReady: boolean;
	language: string | null;
}

export function useShikiHighlighter({
	filePath,
	lines,
	visibleRange,
	theme = "github-dark-default",
	enabled = true,
}: UseShikiHighlighterOptions): ShikiHighlighterAPI {
	const [isReady, setIsReady] = useState(false);
	const [, setHighlightVersion] = useState(0); // Force re-render when highlighting completes
	const cacheRef = useRef<Map<number, string>>(new Map());
	const highlighterRef = useRef<Highlighter | null>(null);
	const langRef = useRef<BundledLanguage | null>(null);

	// Detect language from file path
	const language = getLanguageFromPath(filePath);

	// Store visible range in ref so we can use it in init
	const visibleRangeRef = useRef(visibleRange);
	visibleRangeRef.current = visibleRange;
	const linesRef = useRef(lines);
	linesRef.current = lines;

	// Initialize highlighter and highlight initial visible lines immediately
	useEffect(() => {
		cacheRef.current.clear();

		if (!enabled || !language) {
			setIsReady(true); // Ready but won't highlight
			return;
		}
		const resolvedLanguage = language;

		const controller = new AbortController();
		const { signal } = controller;
		setIsReady(false);

		async function init() {
			try {
				const hl = await getHighlighter();
				if (signal.aborted) return;

				await ensureLanguage(hl, resolvedLanguage);
				await ensureTheme(hl, theme);
				if (signal.aborted) return;

				highlighterRef.current = hl;
				langRef.current = resolvedLanguage;

				const [start, end] = visibleRangeRef.current;
				const currentLines = linesRef.current;
				const highlighted = highlightLineRange(
					hl,
					currentLines,
					start,
					end,
					resolvedLanguage,
					theme
				);
				for (const [lineIdx, html] of highlighted) {
					cacheRef.current.set(lineIdx, html);
				}

				setIsReady(true);
				setHighlightVersion(incrementNumber);
			} catch {
				setIsReady(true); // Continue without highlighting
			}
		}

		init();

		return controller.abort.bind(controller);
	}, [enabled, filePath, language, lines, theme]);

	// Keep normal scrolling responsive; programmatic jumps call
	// ensureHighlightedRange before moving the viewport.
	useEffect(() => {
		if (!isReady || !highlighterRef.current || !langRef.current) return;

		return scheduleHighlightWork(() => {
			const [start, end] = visibleRangeRef.current;
			const currentLines = linesRef.current;
			const hl = highlighterRef.current;
			const lang = langRef.current;
			if (!hl || !lang) return;

			let missingStart = Number.POSITIVE_INFINITY;
			let missingEnd = -1;

			for (let i = start; i <= end && i < currentLines.length; i++) {
				if (cacheRef.current.has(i)) continue;
				missingStart = Math.min(missingStart, i);
				missingEnd = Math.max(missingEnd, i);
			}

			if (missingEnd >= missingStart) {
				const highlighted = highlightLineRange(
					hl,
					currentLines,
					missingStart,
					missingEnd,
					lang,
					theme
				);
				for (const [lineIdx, html] of highlighted) {
					cacheRef.current.set(lineIdx, html);
				}
				setHighlightVersion(incrementNumber);
			}
		});
	}, [isReady, visibleRange, lines, theme]);

	const getHighlightedLine = useCallback(
		(lineIdx: number): string | undefined => cacheRef.current.get(lineIdx),
		[]
	);
	const ensureHighlightedRange = useCallback(
		(start: number, end: number) => {
			const hl = highlighterRef.current;
			const lang = langRef.current;
			const currentLines = linesRef.current;
			if (!isReady || !hl || !lang || currentLines.length === 0) return false;

			const safeStart = Math.max(0, Math.floor(start));
			const safeEnd = Math.min(currentLines.length - 1, Math.ceil(end));
			let missingStart = Number.POSITIVE_INFINITY;
			let missingEnd = -1;

			for (let i = safeStart; i <= safeEnd; i++) {
				if (cacheRef.current.has(i)) continue;
				missingStart = Math.min(missingStart, i);
				missingEnd = Math.max(missingEnd, i);
			}

			if (missingEnd < missingStart) return true;

			const highlighted = highlightLineRange(
				hl,
				currentLines,
				missingStart,
				missingEnd,
				lang,
				theme
			);
			for (const [lineIdx, html] of highlighted) {
				cacheRef.current.set(lineIdx, html);
			}
			setHighlightVersion(incrementNumber);
			return true;
		},
		[isReady, theme]
	);

	return {
		ensureHighlightedRange,
		getHighlightedLine,
		isReady,
		language,
	};
}

const LINE_SPAN_PREFIX = '<span class="line">';
const SPAN_CLOSE = "</span>";
function unwrapLineSpan(html: string): string {
	const trimmed = html.trim();
	if (trimmed.startsWith(LINE_SPAN_PREFIX) && trimmed.endsWith(SPAN_CLOSE)) {
		return trimmed.slice(LINE_SPAN_PREFIX.length, -SPAN_CLOSE.length);
	}
	return trimmed;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}
export function useShikiSnippet(
	lines: string[],
	filePath: string,
	enabled = true,
	theme: SyntaxHighlightTheme = DEFAULT_SYNTAX_HIGHLIGHT_THEME
): { highlighted: Map<number, string>; isReady: boolean } {
	const [highlighted, setHighlighted] = useState<Map<number, string>>(
		new Map()
	);
	const [isReady, setIsReady] = useState(false);
	const linesRef = useRef<string[]>([]);

	const language = getLanguageFromPath(filePath);

	useEffect(() => {
		// Only re-highlight if lines actually changed
		const linesChanged =
			lines.length !== linesRef.current.length ||
			lines.some((l, i) => l !== linesRef.current[i]);

		if (!linesChanged && isReady) return;
		linesRef.current = lines;

		if (!enabled || !language || lines.length === 0) {
			setIsReady(true);
			return;
		}
		const resolvedLanguage = language;

		const controller = new AbortController();
		const { signal } = controller;

		async function highlight() {
			try {
				const hl = await getHighlighter();
				if (signal.aborted) return;

				await ensureLanguage(hl, resolvedLanguage);
				await ensureTheme(hl, theme);
				if (signal.aborted) return;

				const result = highlightLineRange(
					hl,
					lines,
					0,
					lines.length - 1,
					resolvedLanguage,
					theme
				);

				if (!signal.aborted) {
					setHighlighted(result);
					setIsReady(true);
				}
			} catch {
				if (!signal.aborted) {
					setIsReady(true);
				}
			}
		}

		highlight();

		return controller.abort.bind(controller);
	}, [lines, language, enabled, isReady, theme]);

	return { highlighted, isReady };
}
