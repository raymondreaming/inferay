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
	if (!line) return [{ text: line, type: "default" }];
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
