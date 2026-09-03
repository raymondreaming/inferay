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

const JS_KEYWORDS = new Set([
	"import",
	"export",
	"from",
	"default",
	"const",
	"let",
	"var",
	"function",
	"return",
	"if",
	"else",
	"for",
	"while",
	"do",
	"switch",
	"case",
	"break",
	"continue",
	"new",
	"delete",
	"typeof",
	"instanceof",
	"in",
	"of",
	"class",
	"extends",
	"super",
	"this",
	"async",
	"await",
	"yield",
	"throw",
	"try",
	"catch",
	"finally",
	"true",
	"false",
	"null",
	"undefined",
	"void",
	"as",
	"type",
	"interface",
	"enum",
	"implements",
	"static",
	"readonly",
	"private",
	"public",
	"protected",
	"abstract",
	"declare",
	"module",
	"namespace",
]);

const PY_KEYWORDS = new Set([
	"import",
	"from",
	"def",
	"class",
	"return",
	"if",
	"elif",
	"else",
	"for",
	"while",
	"break",
	"continue",
	"pass",
	"raise",
	"try",
	"except",
	"finally",
	"with",
	"as",
	"lambda",
	"yield",
	"True",
	"False",
	"None",
	"and",
	"or",
	"not",
	"in",
	"is",
	"del",
	"global",
	"nonlocal",
	"assert",
	"async",
	"await",
	"self",
]);

const RUST_KEYWORDS = new Set([
	"fn",
	"let",
	"mut",
	"const",
	"static",
	"struct",
	"enum",
	"impl",
	"trait",
	"type",
	"pub",
	"mod",
	"use",
	"crate",
	"super",
	"self",
	"if",
	"else",
	"match",
	"for",
	"while",
	"loop",
	"break",
	"continue",
	"return",
	"async",
	"await",
	"move",
	"where",
	"true",
	"false",
	"Some",
	"None",
	"Ok",
	"Err",
	"Self",
]);

const GO_KEYWORDS = new Set([
	"package",
	"import",
	"func",
	"return",
	"if",
	"else",
	"for",
	"range",
	"switch",
	"case",
	"default",
	"break",
	"continue",
	"go",
	"defer",
	"chan",
	"select",
	"struct",
	"interface",
	"type",
	"map",
	"var",
	"const",
	"true",
	"false",
	"nil",
	"make",
	"new",
	"append",
	"len",
	"cap",
	"delete",
	"copy",
]);

function getKeywords(ext: string): Set<string> {
	switch (ext) {
		case "ts":
		case "tsx":
		case "js":
		case "jsx":
		case "mjs":
		case "mts":
			return JS_KEYWORDS;
		case "py":
			return PY_KEYWORDS;
		case "rs":
			return RUST_KEYWORDS;
		case "go":
			return GO_KEYWORDS;
		default:
			return JS_KEYWORDS;
	}
}

const isHTML = (ext: string) =>
	["html", "htm", "xml", "svg", "jsx", "tsx"].includes(ext);
const isCSS = (ext: string) => ["css", "scss", "less"].includes(ext);

export function tokenizeLine(line: string, ext: string): Token[] {
	if (!line) return [{ text: line, type: "default" }];

	const tokens: Token[] = [];
	const keywords = getKeywords(ext);
	let i = 0;

	while (i < line.length) {
		// Comments: // or #
		if (
			(line[i] === "/" && line[i + 1] === "/") ||
			(line[i] === "#" && !isCSS(ext))
		) {
			tokens.push({ text: line.slice(i), type: "comment" });
			return tokens;
		}

		// Block comment start
		if (line[i] === "/" && line[i + 1] === "*") {
			const end = line.indexOf("*/", i + 2);
			if (end !== -1) {
				tokens.push({ text: line.slice(i, end + 2), type: "comment" });
				i = end + 2;
				continue;
			}
			tokens.push({ text: line.slice(i), type: "comment" });
			return tokens;
		}

		// Strings
		if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
			const quote = line[i]!;
			let j = i + 1;
			while (j < line.length) {
				if (line[j] === "\\" && j + 1 < line.length) {
					j += 2;
					continue;
				}
				if (line[j] === quote) {
					j++;
					break;
				}
				j++;
			}
			tokens.push({ text: line.slice(i, j), type: "string" });
			i = j;
			continue;
		}

		// Numbers
		if (
			/\d/.test(line[i] ?? "") &&
			(i === 0 || !/\w/.test(line[i - 1] ?? ""))
		) {
			let j = i;
			while (j < line.length && /[\d.xXa-fA-Fe_]/.test(line[j] ?? "")) j++;
			tokens.push({ text: line.slice(i, j), type: "number" });
			i = j;
			continue;
		}

		// HTML tags
		if (line[i] === "<" && isHTML(ext)) {
			const match = line.slice(i).match(/^<\/?[\w-]+/);
			if (match) {
				tokens.push({ text: match[0], type: "tag" });
				i += match[0].length;
				continue;
			}
		}

		// Words (keywords or identifiers)
		if (/[a-zA-Z_$@]/.test(line[i] ?? "")) {
			let j = i;
			while (j < line.length && /[\w$]/.test(line[j] ?? "")) j++;
			const word = line.slice(i, j);
			tokens.push({
				text: word,
				type: keywords.has(word) ? "keyword" : "default",
			});
			i = j;
			continue;
		}

		// Punctuation
		const char = line[i] ?? "";
		if (/[{}()[\];:,.<>!=+\-*/%&|^~?@]/.test(char)) {
			tokens.push({ text: char, type: "punctuation" });
			i++;
			continue;
		}

		// Whitespace and other
		let j = i;
		while (
			j < line.length &&
			!/[a-zA-Z_$@0-9"'`/{}()[\];:,.<>!=+\-*/%&|^~?#]/.test(line[j] ?? "")
		) {
			j++;
		}
		if (j === i) j = i + 1;
		tokens.push({ text: line.slice(i, j), type: "default" });
		i = j;
	}

	return tokens;
}
