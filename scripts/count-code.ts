import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const excludedDirectory =
	/^(?:tests?|__tests__|__fixtures__|fixtures|__mocks__|vendor|tooling|scripts|node_modules|target|dist|build|coverage|generated|__generated__)$/;
const excludedFile =
	/(?:\.(?:test|spec|stories|generated|gen)\.|(?:^|[.-])styles?(?:[.-]|$))/i;

function files(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory())
			return excludedDirectory.test(entry.name) ? [] : files(path);
		return entry.isFile() && !excludedFile.test(entry.name) ? [path] : [];
	});
}

function lines(source: string): number {
	return source ? source.split("\n").length - Number(source.endsWith("\n")) : 0;
}

// Mask Rust comments and literals before balancing test item braces. Preserve
// offsets/newlines so braces inside strings and nested comments cannot skew totals.
export function rustProductionLines(source: string): number {
	const chars = source.split("");
	let i = 0;
	while (i < source.length) {
		const start = i;
		const tail = source.slice(i);
		const raw = /^(?:br|cr|r)(#*)"/.exec(tail);
		const character =
			/^'(?:\\(?:u\{[\da-fA-F_]+\}|x[\da-fA-F]{2}|.)|[^'\\\n])'/.exec(tail);
		if (tail.startsWith("//")) {
			i = source.indexOf("\n", i);
			if (i < 0) i = source.length;
		} else if (tail.startsWith("/*")) {
			i += 2;
			let depth = 1;
			while (i < source.length && depth) {
				if (source.startsWith("/*", i)) {
					depth++;
					i += 2;
				} else if (source.startsWith("*/", i)) {
					depth--;
					i += 2;
				} else i++;
			}
		} else if (raw) {
			const closing = `"${raw[1]}`;
			const end = source.indexOf(closing, i + raw[0].length);
			i = end < 0 ? source.length : end + closing.length;
		} else if (tail.startsWith('"')) {
			i++;
			while (i < source.length) {
				if (source[i] === "\\") i += 2;
				else if (source[i++] === '"') break;
			}
		} else if (character) i += character[0].length;
		else {
			i++;
			continue;
		}
		for (let j = start; j < Math.min(i, chars.length); j++)
			if (chars[j] !== "\n") chars[j] = " ";
	}
	const masked = chars.join("");
	const excluded = new Set<number>();
	for (const match of masked.matchAll(
		/#\s*\[\s*(?:cfg\s*\(\s*test\s*\)|(?:tokio::)?test(?:\([^\]]*\))?)\s*\]/g,
	)) {
		let end = match.index + match[0].length;
		let depth = 0;
		for (; end < masked.length; end++) {
			if (masked[end] === "{") depth++;
			else if (masked[end] === "}" && --depth === 0) {
				end++;
				break;
			} else if (masked[end] === ";" && depth === 0) {
				end++;
				break;
			}
		}
		// Offsets are converted to zero-based line indices, including partial lines.
		const firstIndex = masked.slice(0, match.index).split("\n").length - 1;
		const lastIndex = masked.slice(0, end).split("\n").length - 1;
		for (let line = firstIndex; line <= lastIndex; line++) excluded.add(line);
	}
	return lines(source) - excluded.size;
}

if (import.meta.main) {
	const categories = [
		"gpui",
		"core",
		"presentation",
		"diff-engine",
		"server",
	].map((name) => {
		const sources = files(join(root, "native", name, "src")).filter((path) =>
			path.endsWith(".rs"),
		);
		return {
			category: name,
			files: sources.length,
			lines: sources.reduce(
				(sum, path) => sum + rustProductionLines(readFileSync(path, "utf8")),
				0,
			),
		};
	});
	console.table([
		...categories,
		{
			category: "TOTAL",
			files: categories.reduce((n, r) => n + r.files, 0),
			lines: categories.reduce((n, r) => n + r.lines, 0),
		},
	]);
	console.log(
		"Production Rust source; tests and vendored dependencies excluded. Includes comments and blank lines.",
	);
}
