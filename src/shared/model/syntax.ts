/** Closed token vocabulary emitted by the native syntax classifier. */
export type SyntaxKind =
	| "attribute"
	| "comment"
	| "constant"
	| "control"
	| "variable"
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

const MAX_HIGHLIGHT_CHARS = 2_000_000;
const MAX_HIGHLIGHT_LINES = 50_000;
const MAX_HIGHLIGHT_LINE_CHARS = 4_000;

/** Avoid sending source the native classifier will deliberately reject. */
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

/** A compact cache identity that does not retain every open document. */
export function contentKey(lines: string[]): string {
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
