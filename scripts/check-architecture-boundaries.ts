import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import * as t from "@babel/types";

type SourceFiles = Record<string, string>;
const root = resolve(import.meta.dir, "..");
const sourceRoot = join(root, "src");
const nativeClient = "src/shared/lib/native.tsx";
const sourceExtensions = new Set([".ts", ".tsx"]);
const importAliases: Record<string, string> = {
	"@app": "src/app",
	"@agents": "src/modules/agents",
	"@context": "src/modules/context",
	"@conversation": "src/modules/conversation",
	"@design-system": "src/design-system",
	"@explorer": "src/modules/explorer",
	"@repository": "src/modules/repository",
	"@settings": "src/modules/settings",
	"@shared": "src/shared",
	"@skills": "src/modules/skills",
	"@workspace": "src/modules/workspace",
};
const frozenFileCaps: Record<string, number> = {
	"src/modules/repository/hooks/useRepositoryWorkbench.tsx": 1253,
	"src/modules/workspace/components/WorkspaceCanvas/index.tsx": 989,
	"src/modules/repository/components/graph/components/CommitGraph/useCommitGraphState.tsx": 680,
	"src/modules/conversation/components/AgentChatView/useChatConnection.tsx": 509,
};
const transportNames = new Set([
	"fetchJson",
	"fetchJsonOr",
	"postJson",
	"sendJson",
	"request",
]);

function filesIn(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? filesIn(path) : [path];
	});
}

function productionFiles(): SourceFiles {
	return Object.fromEntries(
		filesIn(sourceRoot)
			.filter((path) => sourceExtensions.has(path.slice(path.lastIndexOf("."))))
			.map((path) => [relative(root, path), readFileSync(path, "utf8")]),
	);
}

type Dependency = { specifier: string; transport: boolean };
function dependencies(source: string): Dependency[] {
	const result: Dependency[] = [];
	const ast = parse(source, {
		sourceType: "module",
		plugins: ["typescript", "jsx"],
	});
	const name = (node: t.Identifier | t.StringLiteral) =>
		t.isIdentifier(node) ? node.name : node.value;
	t.traverseFast(ast, (node) => {
		if (t.isImportDeclaration(node)) {
			result.push({
				specifier: node.source.value,
				transport:
					node.importKind !== "type" &&
					node.specifiers.some(
						(entry) =>
							t.isImportNamespaceSpecifier(entry) ||
							(t.isImportSpecifier(entry) &&
								entry.importKind !== "type" &&
								transportNames.has(name(entry.imported))),
					),
			});
		} else if (t.isExportNamedDeclaration(node) && node.source) {
			result.push({
				specifier: node.source.value,
				transport:
					node.exportKind !== "type" &&
					node.specifiers.some(
						(entry) =>
							t.isExportNamespaceSpecifier(entry) ||
							(t.isExportSpecifier(entry) &&
								entry.exportKind !== "type" &&
								transportNames.has(name(entry.local))),
					),
			});
		} else if (t.isExportAllDeclaration(node)) {
			result.push({
				specifier: node.source.value,
				transport: node.exportKind !== "type",
			});
		} else if (
			t.isCallExpression(node) &&
			t.isImport(node.callee) &&
			t.isStringLiteral(node.arguments[0])
		) {
			result.push({ specifier: node.arguments[0].value, transport: true });
		} else if (t.isImportExpression(node) && t.isStringLiteral(node.source)) {
			result.push({ specifier: node.source.value, transport: true });
		}
	});
	return result;
}

function resolvedImport(
	path: string,
	specifier: string,
	files: SourceFiles,
	allowUnlisted = false,
): string | undefined {
	const alias = Object.entries(importAliases).find(
		([name]) => specifier === name || specifier.startsWith(`${name}/`),
	);
	if (!specifier.startsWith(".") && !alias) return undefined;
	const base = alias
		? resolve(root, alias[1], specifier.slice(alias[0].length + 1))
		: resolve(root, dirname(path), specifier);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.tsx"),
		join(base, "index.ts"),
	]) {
		const local = relative(root, candidate);
		if (files[local] !== undefined) return local;
	}
	return allowUnlisted ? relative(root, base) : undefined;
}

function cycles(
	files: SourceFiles,
	graph: Record<string, Dependency[]>,
): string[] {
	const state = new Map<string, "visiting" | "visited">();
	const stack: string[] = [];
	const violations: string[] = [];
	const visit = (path: string) => {
		state.set(path, "visiting");
		stack.push(path);
		for (const { specifier } of graph[path]!) {
			const target = resolvedImport(path, specifier, files);
			if (!target || state.get(target) === "visited") continue;
			if (state.get(target) === "visiting") {
				const start = stack.indexOf(target);
				violations.push(
					`${path}: circular dependency ${[...stack.slice(start), target].join(" -> ")}`,
				);
				continue;
			}
			visit(target);
		}
		stack.pop();
		state.set(path, "visited");
	};
	for (const path of Object.keys(files)) if (!state.has(path)) visit(path);
	return violations;
}

export function architectureViolations(files = productionFiles()): string[] {
	const violations: string[] = [];
	const graph = Object.fromEntries(
		Object.entries(files).map(([path, source]) => [path, dependencies(source)]),
	);
	for (const [path, source] of Object.entries(files)) {
		const lines = source.split("\n").length - Number(source.endsWith("\n"));
		const cap =
			frozenFileCaps[path] ??
			(path.includes("/components/") && !path.endsWith("/styles.ts")
				? 500
				: undefined);
		if (cap !== undefined && lines > cap)
			violations.push(`${path}: exceeds its ${cap}-line responsibility cap`);
		for (const { specifier, transport } of graph[path]!) {
			const target = resolvedImport(path, specifier, files, true);
			if (
				path.startsWith("src/shared/") &&
				target &&
				/^src\/(?:app|modules|adapters)\//.test(target)
			)
				violations.push(
					`${path}: shared code must not import app, modules, or adapters`,
				);
			if (
				path.startsWith("src/modules/") &&
				target &&
				/^src\/(?:app\/|(?:client|router)\.tsx?$)/.test(target)
			)
				violations.push(
					`${path}: features must not import the composition root`,
				);
			if (
				path.includes("/model/") &&
				(/^(?:solid-js|@solidjs\/|react|@tanstack\/)/.test(specifier) ||
					(target &&
						/\/(?:components|hooks|services|ui|app)\/|\/lib\/(?:native|dom)\.tsx?$/.test(
							target,
						)))
			)
				violations.push(
					`${path}: models must not import UI, hooks, services, or runtime adapters`,
				);
			if (
				path !== nativeClient &&
				target?.replace(/\.tsx?$/, "") ===
					nativeClient.replace(/\.tsx?$/, "") &&
				transport &&
				!path.includes("/services/")
			)
				violations.push(
					`${path}: endpoint transport belongs in its feature service`,
				);
		}
		if (path !== nativeClient && /\bfetch\s*\(/.test(source))
			violations.push(`${path}: only ${nativeClient} may call fetch()`);
		if (
			/\b(?:import|export)\b[^"']*["'][^"']*(?:\.test\.|\.spec\.|\/tests\/)[^"']*["']/.test(
				source,
			)
		)
			violations.push(`${path}: production code must not import test code`);
	}
	return [...violations, ...cycles(files, graph)];
}

const violations = architectureViolations();
if (violations.length) {
	console.error(violations.join("\n"));
	process.exitCode = 1;
} else {
	console.log("Architecture boundaries passed.");
}
