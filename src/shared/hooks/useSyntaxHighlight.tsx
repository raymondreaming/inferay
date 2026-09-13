import {
	contentKey,
	type SyntaxKind,
	type SyntaxToken,
	shouldDisableSnippetHighlighting,
} from "@shared/model/syntax.ts";
import {
	type ClassifiedDocument,
	highlightSyntax,
} from "@shared/services/syntaxApi.ts";
import { type Accessor, createMemo, createSignal, onSettled } from "solid-js";
import {
	dispatchWindowEvent,
	listenWindowEvent,
	queryClient,
} from "../lib/dom.tsx";
import { readStoredValue, writeStoredValue } from "../lib/native.tsx";
import { useBackgroundQuery as useQuery } from "./useQueryResource.tsx";

/** Query lifecycle only: native code owns all syntax interpretation. Kinds are
 *  a closed vocabulary the stylesheet colours, so one classification serves
 *  every theme and the client never ships a grammar. */
export { type SyntaxKind, type SyntaxToken, shouldDisableSnippetHighlighting };

type HighlightInput = {
	filePath: string;
	lines: string[];
	lineTypes?: string[];
	enabled?: boolean;
	preview?: boolean;
};
function syntaxQueryOptions(input: HighlightInput) {
	const enabled =
		input.enabled !== false &&
		input.lines.length > 0 &&
		!shouldDisableSnippetHighlighting(input.lines);
	const path = input.filePath;
	const text = enabled ? input.lines.join("\n") : "";
	const lineTypes = input.lineTypes ? [...input.lineTypes] : undefined;
	return {
		queryKey: [
			"syntax",
			4,
			path,
			enabled ? contentKey(input.lines) : String(input.lines.length),
			lineTypes ? contentKey(lineTypes) : "source",
		],
		enabled,
		queryFn: ({ signal }: { signal: AbortSignal }) =>
			highlightSyntax(
				{ path, text, lineTypes, preview: input.preview === true },
				AbortSignal.any([signal, AbortSignal.timeout(15000)]),
			),
		staleTime: Infinity,
		gcTime: 5 * 60_000,
		retry: false as const,
	};
}
/** Parse from the beginning to preserve multiline grammar state, but stop
 * after the initial viewport. The complete document fills in independently. */
export async function prefetchSyntaxPreview(
	input: HighlightInput,
	lineCount = 200,
): Promise<void> {
	const complete = syntaxQueryOptions({ ...input, preview: true });
	if (
		!complete.enabled ||
		queryClient.getQueryData(complete.queryKey) !== undefined
	)
		return;
	const count = Math.min(input.lines.length, Math.max(200, lineCount));
	// Small documents cost less as one request than as a preview plus a refill.
	if (input.lines.length - count < 200) {
		await queryClient.prefetchQuery(complete);
		return;
	}
	const preview = syntaxQueryOptions({
		...input,
		preview: true,
		lines: input.lines.slice(0, count),
		lineTypes: input.lineTypes?.slice(0, count),
	});
	const queryKey = [...complete.queryKey, "preview"];
	const cached = queryClient.getQueryData<ClassifiedDocument | null>(queryKey);
	await queryClient.prefetchQuery({
		...preview,
		queryKey,
		// A later opening may start deeper in the same source.
		staleTime: cached && cached.lines.length >= count ? Infinity : 0,
	});
}
export function useSyntaxHighlight(_options: Accessor<HighlightInput>) {
	const options = createMemo(() => syntaxQueryOptions(_options()));
	const active = createMemo(() => options().enabled);
	const query = useQuery(options, () => queryClient);
	// Slicing every line up front wastes the work virtualization exists to
	// avoid, so tokens are cut on demand and kept per document.
	const document = createMemo(() => {
		// Observe fetch completion, but always select the current document's cache entry.
		// Cached navigation must not wait for the observer effect or use the previous file's runs.
		query.data;
		return active()
			? (queryClient.getQueryData<ClassifiedDocument | null>(
					options().queryKey,
				) ??
					queryClient.getQueryData<ClassifiedDocument | null>([
						...options().queryKey,
						"preview",
					]) ??
					null)
			: null;
	});
	const tokens = createMemo(() => {
		document();
		return new Map<number, SyntaxToken[]>();
	});
	const getLineTokens = (index: number): SyntaxToken[] | undefined => {
		const runs = document()?.lines[index];
		const text = _options().lines[index];
		if (!runs || text === undefined) return undefined;
		const cached = tokens().get(index);
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
			cut.push({
				text: text.slice(offset),
				kind: "plain",
			});
		tokens().set(index, cut);
		return cut;
	};
	return {
		getLineTokens,
		get isReady() {
			return !active() || document() !== null || !query.isPending;
		},
		get language() {
			return document()?.language ?? null;
		},
	};
}
export const SYNTAX_HIGHLIGHT_THEMES = [
	{ id: "vscode-black", label: "Black" },
	{
		id: "contrast",
		label: "High Contrast",
	},
	{
		id: "vitesse",
		label: "Vitesse",
	},
	{
		id: "one-dark",
		label: "One Dark",
	},
	{
		id: "dracula",
		label: "Dracula",
	},
	{
		id: "slack",
		label: "Slack",
	},
] as const;
export type SyntaxHighlightTheme =
	(typeof SYNTAX_HIGHLIGHT_THEMES)[number]["id"];
export const DEFAULT_SYNTAX_HIGHLIGHT_THEME: SyntaxHighlightTheme =
	"vscode-black";
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
	const [theme, setTheme] = createSignal(
		(() => normalize(readStoredValue(SYNTAX_THEME_STORAGE_KEY)))(),
	);
	onSettled(() => {
		return listenWindowEvent(SYNTAX_THEME_EVENT, (event: Event) =>
			setTheme(normalize((event as CustomEvent<string>).detail ?? null)),
		);
	});
	const select = (next: SyntaxHighlightTheme) => {
		const resolved = normalize(next);
		setTheme(resolved);
		applySyntaxTheme(resolved);
		writeStoredValue(SYNTAX_THEME_STORAGE_KEY, resolved);
		dispatchWindowEvent(SYNTAX_THEME_EVENT, resolved);
	};
	return [() => theme(), select] as const;
}
export function restoreSyntaxTheme(): void {
	applySyntaxTheme(normalize(readStoredValue(SYNTAX_THEME_STORAGE_KEY)));
}
