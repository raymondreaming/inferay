import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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
// Existing cycles are frozen while their parent/child public interfaces are
// extracted. New cycles fail immediately; remove an entry when its seam is fixed.
const grandfatheredCycleOrigins = new Set([
	"src/shared/ui/DropdownButton/DropdownCustomOption.tsx",
	"src/shared/ui/DropdownButton/DropdownOptions.tsx",
	"src/modules/explorer/components/FileTypeIcon/FolderTypeIcon.tsx",
	"src/shared/ui/DotMatrixLoader/DotMatrixRipple.tsx",
	"src/shared/ui/DotMatrixLoader/DotMatrixWeave.tsx",
	"src/modules/conversation/components/AgentChatView/useChatConnection.tsx",
	"src/modules/conversation/components/AgentChatView/transcriptSplice.ts",
	"src/modules/repository/components/operations/ChatDiffPanel/useChatDiffPanelState.tsx",
	"src/modules/explorer/components/FileSearch/FileSearchResultRow.tsx",
]);
// Endpoint transport belongs in feature services. Keep this empty: adding an
// exception requires an explicit migration plan and a matching removal test.
const grandfatheredTransportOrigins = new Set<string>();

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

function imports(source: string): string[] {
	return [
		...source.matchAll(
			/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
		),
	].map((match) => match[1]!);
}

function importsNativeTransport(source: string): boolean {
	return [
		...source.matchAll(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@shared\/lib\/native\.tsx["']/g,
		),
	].some((match) =>
		/\b(?:fetchJson|fetchJsonOr|postJson|sendJson|request)\b/.test(match[1]!),
	);
}

function resolvesToFeature(specifier: string): boolean {
	return /(?:^|\/)\.{1,2}\/.*(?:^|\/)(?:app|modules|adapters)(?:\/|$)/.test(
		specifier,
	);
}

function resolvedImport(
	path: string,
	specifier: string,
	files: SourceFiles,
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
	return undefined;
}

function cycles(files: SourceFiles): string[] {
	const state = new Map<string, "visiting" | "visited">();
	const stack: string[] = [];
	const violations: string[] = [];
	const visit = (path: string) => {
		state.set(path, "visiting");
		stack.push(path);
		for (const specifier of imports(files[path]!)) {
			const target = resolvedImport(path, specifier, files);
			if (!target || state.get(target) === "visited") continue;
			if (state.get(target) === "visiting") {
				const start = stack.indexOf(target);
				if (!grandfatheredCycleOrigins.has(path))
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
	for (const [path, source] of Object.entries(files)) {
		const lines = source.split("\n").length - Number(source.endsWith("\n"));
		const cap =
			frozenFileCaps[path] ??
			(path.includes("/components/") && !path.endsWith("/styles.ts")
				? 500
				: undefined);
		if (cap !== undefined && lines > cap)
			violations.push(`${path}: exceeds its ${cap}-line responsibility cap`);
		if (path.startsWith("src/shared/")) {
			for (const specifier of imports(source)) {
				if (resolvesToFeature(specifier))
					violations.push(
						`${path}: shared code must not import app, modules, or adapters`,
					);
			}
		}
		if (path !== nativeClient && /\bfetch\s*\(/.test(source))
			violations.push(`${path}: only ${nativeClient} may call fetch()`);
		if (
			path !== nativeClient &&
			importsNativeTransport(source) &&
			!path.includes("/services/") &&
			!grandfatheredTransportOrigins.has(path)
		)
			violations.push(
				`${path}: endpoint transport belongs in its feature service`,
			);
		if (
			/\b(?:import|export)\b[^"']*["'][^"']*(?:\.test\.|\.spec\.|\/tests\/)[^"']*["']/.test(
				source,
			)
		)
			violations.push(`${path}: production code must not import test code`);
	}
	return [...violations, ...cycles(files)];
}

const violations = architectureViolations();
if (violations.length) {
	console.error(violations.join("\n"));
	process.exitCode = 1;
} else {
	console.log("Architecture boundaries passed.");
}
