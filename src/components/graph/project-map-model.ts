import type { GitProjectStatus } from "../../features/git/types.ts";

export interface ProjectMapSymbol {
	readonly kind: "route" | "function" | "type" | "component" | string;
	readonly name: string;
	readonly line: number;
}

export interface ProjectMapFile {
	readonly name: string;
	readonly path: string;
	readonly directory: string;
	readonly extension: string;
	readonly language: string;
	readonly lines: number;
	readonly bytes: number;
	readonly symbols: readonly ProjectMapSymbol[];
}

export interface ProjectMapEdge {
	readonly source: string;
	readonly target: string;
}

export interface ProjectMapData {
	readonly name: string;
	readonly cwd: string;
	readonly files: readonly ProjectMapFile[];
	readonly edges: readonly ProjectMapEdge[];
	readonly totalFiles: number;
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly directoryCount: number;
	readonly symbolCount: number;
	readonly languageCounts: Readonly<Record<string, number>>;
	readonly truncated: boolean;
}

export type AtlasNodeStatus = "normal" | "modified" | "added";

export function atlasFileLabel(
	file: Pick<ProjectMapFile, "directory" | "name">,
) {
	const stem = file.name.replace(/\.[^.]+$/, "");
	if (stem.toLowerCase() !== "index") return stem;
	const parent = file.directory.split("/").filter(Boolean).at(-1);
	return parent ? `${parent}/index` : stem;
}

export interface AtlasConnection {
	readonly target: string;
	readonly count: number;
}

export interface AtlasDistrict {
	readonly id: string;
	readonly code: string;
	readonly label: string;
	readonly files: readonly ProjectMapFile[];
	readonly fileCount: number;
	readonly lines: number;
	readonly symbolCount: number;
	readonly languages: readonly [string, number][];
	readonly status: AtlasNodeStatus;
	readonly x: number;
	readonly y: number;
	readonly height: number;
	readonly connections: readonly AtlasConnection[];
}

export interface AtlasFileNode {
	readonly id: string;
	readonly code: string;
	readonly file: ProjectMapFile;
	readonly x: number;
	readonly y: number;
	readonly height: number;
	readonly status: AtlasNodeStatus;
	readonly connections: readonly AtlasConnection[];
}

export interface ProjectAtlas {
	readonly districts: readonly AtlasDistrict[];
	readonly districtByFile: ReadonlyMap<string, string>;
	readonly primaryPath: readonly string[];
}

const TOP_LEVEL_NAMES = new Set([
	"src",
	"app",
	"apps",
	"native",
	"packages",
	"site",
	"web",
	"server",
	"client",
]);

export function districtIdForPath(path: string) {
	const parts = path.split("/").filter(Boolean);
	if (parts.length <= 1) return "root";
	if (TOP_LEVEL_NAMES.has(parts[0]!) && parts.length > 2) {
		return `${parts[0]}/${parts[1]}`;
	}
	return parts[0]!;
}

function districtCode(id: string, used: Set<string>) {
	const label = id === "root" ? "ROOT" : (id.split("/").pop() ?? id);
	const letters = label.replace(/[^a-z0-9]/gi, "").toUpperCase();
	const base = (letters || "MOD").slice(0, 5);
	let code = base;
	let suffix = 2;
	while (used.has(code)) {
		code = `${base.slice(0, 3)}${suffix}`;
		suffix += 1;
	}
	used.add(code);
	return code;
}

function fileStatus(project: GitProjectStatus | null, path: string) {
	const changed = project?.files.find((file) => file.path === path);
	if (!changed) return "normal" as const;
	if (changed.status === "?" || changed.status === "A") return "added" as const;
	return "modified" as const;
}

function combinedStatus(
	project: GitProjectStatus | null,
	files: readonly ProjectMapFile[],
): AtlasNodeStatus {
	let status: AtlasNodeStatus = "normal";
	for (const file of files) {
		const next = fileStatus(project, file.path);
		if (next === "modified") return next;
		if (next === "added") status = next;
	}
	return status;
}

function connectionList(counts: ReadonlyMap<string, number>) {
	return [...counts]
		.map(([target, count]) => ({ target, count }))
		.toSorted((a, b) => b.count - a.count || a.target.localeCompare(b.target));
}

function tracePath(
	districts: readonly Pick<AtlasDistrict, "id" | "connections">[],
) {
	if (districts.length === 0) return [];
	const incoming = new Map<string, number>();
	for (const district of districts) {
		for (const connection of district.connections) {
			incoming.set(
				connection.target,
				(incoming.get(connection.target) ?? 0) + connection.count,
			);
		}
	}
	const start = districts.toSorted((a, b) => {
		const aScore =
			a.connections.reduce((sum, item) => sum + item.count, 0) -
			(incoming.get(a.id) ?? 0);
		const bScore =
			b.connections.reduce((sum, item) => sum + item.count, 0) -
			(incoming.get(b.id) ?? 0);
		return bScore - aScore || b.connections.length - a.connections.length;
	})[0]!;
	const byId = new Map(districts.map((district) => [district.id, district]));
	const visited = new Set([start.id]);
	const path = [start.id];
	let current = start;
	while (path.length < Math.min(7, districts.length)) {
		const next = current.connections.find(
			(connection) =>
				!visited.has(connection.target) && byId.has(connection.target),
		);
		if (!next) break;
		path.push(next.target);
		visited.add(next.target);
		current = byId.get(next.target)!;
	}
	return path.length > 1 ? path : [];
}

export function buildProjectAtlas(
	data: ProjectMapData,
	project: GitProjectStatus | null,
): ProjectAtlas {
	const filesByDistrict = new Map<string, ProjectMapFile[]>();
	const districtByFile = new Map<string, string>();
	for (const file of data.files) {
		const id = districtIdForPath(file.path);
		const files = filesByDistrict.get(id) ?? [];
		files.push(file);
		filesByDistrict.set(id, files);
		districtByFile.set(file.path, id);
	}

	const districtEdges = new Map<string, Map<string, number>>();
	for (const edge of data.edges) {
		const source = districtByFile.get(edge.source);
		const target = districtByFile.get(edge.target);
		if (!source || !target || source === target) continue;
		const targets = districtEdges.get(source) ?? new Map<string, number>();
		targets.set(target, (targets.get(target) ?? 0) + 1);
		districtEdges.set(source, targets);
	}

	const usedCodes = new Set<string>();
	const entries = [...filesByDistrict]
		.map(([id, files]) => ({
			id,
			files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
			lines: files.reduce((sum, file) => sum + file.lines, 0),
			symbolCount: files.reduce((sum, file) => sum + file.symbols.length, 0),
		}))
		.toSorted((a, b) => b.lines - a.lines || a.id.localeCompare(b.id));
	const columns = Math.min(
		5,
		Math.max(3, Math.ceil(Math.sqrt(entries.length * 1.35))),
	);
	const districts = entries.map((entry, index): AtlasDistrict => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const languageCounts = new Map<string, number>();
		for (const file of entry.files) {
			languageCounts.set(
				file.language,
				(languageCounts.get(file.language) ?? 0) + 1,
			);
		}
		return {
			id: entry.id,
			code: districtCode(entry.id, usedCodes),
			label: entry.id === "root" ? "Project root" : entry.id,
			files: entry.files,
			fileCount: entry.files.length,
			lines: entry.lines,
			symbolCount: entry.symbolCount,
			languages: [...languageCounts].toSorted((a, b) => b[1] - a[1]),
			status: combinedStatus(project, entry.files),
			x: 600 + (column - row) * 112,
			y: 195 + (column + row) * 52,
			height: 42 + Math.min(82, Math.round(Math.log2(entry.lines + 1) * 6)),
			connections: connectionList(districtEdges.get(entry.id) ?? new Map()),
		};
	});

	return {
		districts,
		districtByFile,
		primaryPath: tracePath(districts),
	};
}

export function buildDistrictFileNodes(
	district: AtlasDistrict,
	edges: readonly ProjectMapEdge[],
	project: GitProjectStatus | null,
): AtlasFileNode[] {
	const visibleFiles = district.files.slice(0, 80);
	const visible = new Set(visibleFiles.map((file) => file.path));
	const edgeCounts = new Map<string, Map<string, number>>();
	for (const edge of edges) {
		if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
		const targets = edgeCounts.get(edge.source) ?? new Map<string, number>();
		targets.set(edge.target, (targets.get(edge.target) ?? 0) + 1);
		edgeCounts.set(edge.source, targets);
	}
	const columns = Math.min(
		9,
		Math.max(5, Math.ceil(Math.sqrt(visibleFiles.length * 1.5))),
	);
	return visibleFiles.map((file, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		return {
			id: file.path,
			code: file.extension ? file.extension.toUpperCase().slice(0, 4) : "FILE",
			file,
			x: 600 + (column - row) * 68,
			y: 190 + (column + row) * 32,
			height: 25 + Math.min(38, Math.round(Math.log2(file.lines + 1) * 4)),
			status: fileStatus(project, file.path),
			connections: connectionList(edgeCounts.get(file.path) ?? new Map()),
		};
	});
}
