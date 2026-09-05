import type {
	BundledLanguage,
	BundledTheme,
	GrammarState,
	HighlighterCore,
} from "shiki";
import { ByteCache } from "./byte-cache.ts";
import { syntaxLanguages, syntaxThemes } from "./highlight-bundle.ts";

export interface HighlightToken {
	content: string;
	color?: string;
	bgColor?: string;
}
export interface HighlightDocument {
	lines: string[];
	language: BundledLanguage;
	theme: BundledTheme;
	states: Map<number, GrammarState>;
}
const BLOCK_LINES = 64;
const documents = new ByteCache<HighlightDocument>(24 * 1024 * 1024, 24);
const tokens = new ByteCache<HighlightToken[][]>(16 * 1024 * 1024, 512);
let highlighter: Promise<HighlighterCore> | undefined;
const loading = new Map<string, Promise<void>>();
async function prepare(language: BundledLanguage, theme: BundledTheme) {
	highlighter ??= Promise.all([
		import("shiki/core"),
		import("shiki/engine/oniguruma"),
	]).then(([{ createHighlighterCore }, { createOnigurumaEngine }]) =>
		createHighlighterCore({
			langs: [],
			themes: [],
			engine: createOnigurumaEngine(import("shiki/wasm")),
		}),
	);
	const hl = await highlighter;
	for (const [key, load] of [
		[
			`lang:${language}`,
			async () =>
				hl.loadLanguage(
					(await syntaxLanguages[language as keyof typeof syntaxLanguages]())
						.default,
				),
		],
		[
			`theme:${theme}`,
			async () =>
				hl.loadTheme(
					(await syntaxThemes[theme as keyof typeof syntaxThemes]()).default,
				),
		],
	] as const) {
		if (!loading.has(key))
			loading.set(
				key,
				load().catch((error) => {
					loading.delete(key);
					throw error;
				}),
			);
		await loading.get(key);
	}
	return hl;
}
export function registerHighlightDocument(
	key: string,
	lines: string[],
	language: BundledLanguage,
	theme: BundledTheme,
) {
	if (documents.get(key)) return;
	documents.set(
		key,
		{ lines, language, theme, states: new Map() },
		lines.reduce((size, line) => size + line.length * 2 + 64, 0) +
			Math.ceil(lines.length / BLOCK_LINES) * 4096,
	);
}
export async function highlightDocumentRange(
	key: string,
	start: number,
	end: number,
	signal?: AbortSignal,
): Promise<Array<[number, HighlightToken[]]> | null> {
	const doc = documents.get(key);
	if (!doc) return null;
	const hl = await prepare(doc.language, doc.theme);
	const first = Math.max(0, Math.floor(start / BLOCK_LINES) * BLOCK_LINES);
	const last = Math.min(doc.lines.length, end + 1);
	const result: Array<[number, HighlightToken[]]> = [];
	for (let block = first; block < last; block += BLOCK_LINES) {
		if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
		let highlighted = tokens.get(`${key}\0${block}`);
		if (!highlighted) {
			// Resume at the nearest grammar checkpoint, never an arbitrary
			// context window that can start in the middle of a comment/string.
			let from = block;
			while (from > 0 && !doc.states.has(from)) from -= BLOCK_LINES;
			for (; from <= block; from += BLOCK_LINES) {
				if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
				const chunk = hl.codeToTokensBase(
					doc.lines.slice(from, from + BLOCK_LINES).join("\n"),
					{
						lang: doc.language,
						theme: doc.theme,
						grammarState: doc.states.get(from),
						tokenizeMaxLineLength: 1000,
						tokenizeTimeLimit: 10,
					},
				);
				const state = hl.getLastGrammarState(chunk);
				if (state) doc.states.set(from + BLOCK_LINES, state);
				const compact = chunk.map((line) => {
					const merged: HighlightToken[] = [];
					for (const token of line) {
						const previous = merged.at(-1);
						if (
							previous &&
							previous.color === token.color &&
							previous.bgColor === token.bgColor
						)
							previous.content += token.content;
						else
							merged.push({
								content: token.content,
								color: token.color,
								bgColor: token.bgColor,
							});
					}
					return merged;
				});
				tokens.set(
					`${key}\0${from}`,
					compact,
					compact.reduce(
						(sum, line) =>
							sum +
							line.reduce(
								(size, token) => size + 96 + token.content.length * 2,
								0,
							),
						0,
					),
				);
				if (from === block) highlighted = compact;
				// Yield between bounded chunks so cancellation and newer jobs run.
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
		}
		for (
			let i = Math.max(start, block);
			i < Math.min(last, block + BLOCK_LINES);
			i++
		)
			result.push([i, highlighted?.[i - block] ?? []]);
	}
	return result;
}
