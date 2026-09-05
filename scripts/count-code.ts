import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import type { Node } from "@babel/types";

const root = resolve(import.meta.dir, "..");
const excludedDirectory =
	/^(?:tests?|__tests__|__fixtures__|fixtures|__mocks__|tooling|scripts|node_modules|target|dist|build|coverage|generated|__generated__)$/;
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

function children(node: Node): Node[] {
	return Object.values(node).flatMap((value) => {
		const values = Array.isArray(value) ? value : [value];
		return values.filter(
			(child): child is Node =>
				child && typeof child === "object" && typeof child.type === "string",
		);
	});
}

function contains(node: Node, predicate: (node: Node) => boolean): boolean {
	return (
		predicate(node) ||
		children(node).some((child) => contains(child, predicate))
	);
}

// Static convention: capitalized functions/classes that render JSX, call
// createElement, or return null. Wrapped functions (memo/forwardRef) count once.
export function componentNames(source: string): string[] {
	const ast = parse(source, {
		sourceType: "module",
		plugins: ["typescript", "jsx"],
	});
	const names = new Set<string>();
	function visit(node: Node) {
		let name: string | undefined;
		let body: Node | null | undefined;
		if (
			node.type === "FunctionDeclaration" ||
			node.type === "ClassDeclaration"
		) {
			name = node.id?.name;
			body = node.body;
		} else if (
			node.type === "VariableDeclarator" &&
			node.id.type === "Identifier" &&
			node.init &&
			[
				"ArrowFunctionExpression",
				"FunctionExpression",
				"CallExpression",
			].includes(node.init.type)
		) {
			name = node.id.name;
			body = node.init;
		}
		if (
			name &&
			/^[A-Z]/.test(name) &&
			body &&
			contains(
				body,
				(child) =>
					child.type === "JSXElement" ||
					child.type === "JSXFragment" ||
					(child.type === "ReturnStatement" &&
						child.argument?.type === "NullLiteral") ||
					(child.type === "CallExpression" &&
						(child.callee.type === "Identifier"
							? child.callee.name === "createElement"
							: child.callee.type === "MemberExpression" &&
								child.callee.property.type === "Identifier" &&
								child.callee.property.name === "createElement")),
			)
		)
			names.add(name);
		for (const child of children(node)) visit(child);
	}
	visit(ast.program);
	return [...names];
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
	const rows = [
		{ category: "App .tsx", files: 0, lines: 0 },
		{ category: "App .ts", files: 0, lines: 0 },
		{ category: "Rust .rs", files: 0, lines: 0 },
	];
	const components: { file: string; names: string[]; lines: number }[] = [];
	for (const file of [
		...files(join(root, "src")),
		...files(join(root, "native")),
	].sort()) {
		const index = file.endsWith(".tsx")
			? 0
			: file.endsWith(".ts")
				? 1
				: file.endsWith(".rs")
					? 2
					: -1;
		if (index < 0) continue;
		const source = readFileSync(file, "utf8");
		const count = index === 2 ? rustProductionLines(source) : lines(source);
		if (!count) continue;
		rows[index].files++;
		rows[index].lines += count;
		if (index !== 2) {
			const names = componentNames(source);
			if (names.length)
				components.push({ file: relative(root, file), names, lines: count });
		}
	}
	const report = {
		components: {
			definitions: components.reduce((sum, item) => sum + item.names.length, 0),
			files: components.length,
			lines: components.reduce((sum, item) => sum + item.lines, 0),
		},
		categories: rows,
		total: rows.reduce(
			(sum, row) => ({
				files: sum.files + row.files,
				lines: sum.lines + row.lines,
			}),
			{ files: 0, lines: 0 },
		),
	};
	if (process.argv.includes("--json"))
		console.log(
			JSON.stringify({ ...report, componentInventory: components }, null, 2),
		);
	else {
		console.log(
			`React components: ${report.components.definitions} definitions in ${report.components.files} files (${report.components.lines.toLocaleString("en-US")} lines; included below).\n`,
		);
		console.table([...rows, { category: "TOTAL", ...report.total }]);
		console.log(
			"Scope: src/ and native/, excluding styles, tests/fixtures/mocks, tooling, generated files and build/dependency folders.",
		);
		console.log(
			"Lines include comments and blanks; Rust test items/modules are subtracted. Component counts use static naming/render conventions, including Octane components.",
		);
	}
}
