import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import type { Node } from "@babel/types";

const root = resolve(import.meta.dir, "..");
const bridge = join(root, "src/adapters/presentation/model.ts");
const operations = new Set(
	[
		...readFileSync(
			join(root, "native/presentation/src/lib.rs"),
			"utf8",
		).matchAll(/^\s*"([^"]+)"\s*=>/gm),
	].map((match) => match[1]!),
);
const uses = new Map<string, string[]>();
const requiredBindings = ["ChatReplica", "LiquidBody", "ease", "rounded_rect"];
function files(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? files(path)
			: /\.tsx?$/.test(path)
				? [path]
				: [];
	});
}
for (const file of files(join(root, "src"))) {
	const ast = parse(readFileSync(file, "utf8"), {
		sourceType: "module",
		plugins: ["typescript", "jsx"],
	});
	const bindings = new Map<string, string>();
	if (file === bridge) bindings.set("project", "project");
	for (const node of ast.program.body) {
		if (
			node.type !== "ImportDeclaration" ||
			!node.source.value.endsWith("/presentation/model.ts")
		)
			continue;
		for (const specifier of node.specifiers)
			if (
				specifier.type === "ImportSpecifier" &&
				specifier.imported.type === "Identifier"
			)
				bindings.set(specifier.local.name, specifier.imported.name);
	}
	function visit(node: Node) {
		if (
			(node.type === "CallExpression" || node.type === "NewExpression") &&
			node.callee.type === "Identifier"
		) {
			const binding = bindings.get(node.callee.name);
			const first = node.arguments[0];
			const key =
				binding === "project" && first?.type === "StringLiteral"
					? first.value
					: binding && requiredBindings.includes(binding)
						? binding
						: undefined;
			if (key && key !== "project") {
				const sites = uses.get(key) ?? [];
				sites.push(`${relative(root, file)}:${node.loc?.start.line}`);
				uses.set(key, sites);
			}
		}
		for (const value of Object.values(node))
			for (const child of Array.isArray(value) ? value : [value])
				if (
					child &&
					typeof child === "object" &&
					typeof child.type === "string"
				)
					visit(child);
	}
	visit(ast.program);
}
const errors = [
	...[...operations, ...requiredBindings]
		.filter((name) => !uses.has(name))
		.map((name) => `Unused Rust presentation export: ${name}`),
	...[...uses.keys()]
		.filter((name) => !operations.has(name) && !requiredBindings.includes(name))
		.map((name) => `Unknown Rust presentation call: ${name}`),
];
if (errors.length) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
} else {
	console.log(
		`Rust presentation usage: ${operations.size} operations and ${requiredBindings.length} Wasm bindings have renderer call sites.`,
	);
	if (process.argv.includes("--json"))
		console.log(JSON.stringify(Object.fromEntries(uses), null, 2));
}
