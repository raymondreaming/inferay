/** Force layout for the Memory graph: linked items pull together, everything else pushes apart.
 * Deterministic for the same input (positions are seeded from ids) and bounded: repulsion uses a
 * spatial grid, and large graphs run fewer iterations. Pure; no DOM or Solid. */
export type GraphInputNode = { id: string; kind: string };
export type GraphInputEdge = { from: string; to: string };
export type GraphPoint = { x: number; y: number };

function seed(id: string) {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) / 4294967295;
}

export function layoutMemoryGraph(
	nodes: readonly GraphInputNode[],
	edges: readonly GraphInputEdge[],
): Map<string, GraphPoint> {
	const count = nodes.length;
	const index = new Map(nodes.map((node, i) => [node.id, i]));
	const radius = 40 * Math.sqrt(count + 1);
	const x = new Float64Array(count);
	const y = new Float64Array(count);
	nodes.forEach((node, i) => {
		const angle = seed(node.id) * Math.PI * 2;
		const r = radius * Math.sqrt(seed(`${node.id}#r`));
		x[i] = Math.cos(angle) * r;
		y[i] = Math.sin(angle) * r;
	});
	const links = edges.flatMap((edge) => {
		const a = index.get(edge.from);
		const b = index.get(edge.to);
		return a === undefined || b === undefined ? [] : [[a, b] as const];
	});
	const degree = new Float64Array(count);
	for (const [a, b] of links) {
		degree[a]++;
		degree[b]++;
	}
	const iterations = count > 1200 ? 60 : count > 400 ? 120 : 260;
	const cell = 90;
	const linkLength = 90;
	for (let step = 0; step < iterations; step++) {
		const heat = 1 - step / iterations;
		const fx = new Float64Array(count);
		const fy = new Float64Array(count);
		const grid = new Map<string, number[]>();
		for (let i = 0; i < count; i++) {
			const key = `${Math.floor(x[i] / cell)},${Math.floor(y[i] / cell)}`;
			const bucket = grid.get(key);
			if (bucket) bucket.push(i);
			else grid.set(key, [i]);
		}
		for (let i = 0; i < count; i++) {
			const cx = Math.floor(x[i] / cell);
			const cy = Math.floor(y[i] / cell);
			for (let gx = cx - 1; gx <= cx + 1; gx++)
				for (let gy = cy - 1; gy <= cy + 1; gy++)
					for (const j of grid.get(`${gx},${gy}`) ?? []) {
						if (j <= i) continue;
						let dx = x[i] - x[j];
						let dy = y[i] - y[j];
						let d2 = dx * dx + dy * dy;
						if (d2 < 0.01) {
							dx = seed(`${i}:${j}`) - 0.5;
							dy = 0.5 - seed(`${j}:${i}`);
							d2 = dx * dx + dy * dy;
						}
						const push = 2600 / d2;
						fx[i] += dx * push;
						fy[i] += dy * push;
						fx[j] -= dx * push;
						fy[j] -= dy * push;
					}
		}
		for (const [a, b] of links) {
			const dx = x[b] - x[a];
			const dy = y[b] - y[a];
			const d = Math.sqrt(dx * dx + dy * dy) || 1;
			const pull = ((d - linkLength) / d) * 0.06;
			fx[a] += dx * pull * (1 / Math.max(1, degree[a] / 4));
			fy[a] += dy * pull * (1 / Math.max(1, degree[a] / 4));
			fx[b] -= dx * pull * (1 / Math.max(1, degree[b] / 4));
			fy[b] -= dy * pull * (1 / Math.max(1, degree[b] / 4));
		}
		for (let i = 0; i < count; i++) {
			fx[i] -= x[i] * 0.004;
			fy[i] -= y[i] * 0.004;
			const limit = 24 * heat + 1;
			x[i] += Math.max(-limit, Math.min(limit, fx[i]));
			y[i] += Math.max(-limit, Math.min(limit, fy[i]));
		}
	}
	return new Map(nodes.map((node, i) => [node.id, { x: x[i], y: y[i] }]));
}

/** What the graph shows for each memory: the kind of item, how to draw it, and how to describe it. */
export type MemoryItem = {
	id: string;
	kind: "note" | "image" | "file" | "source";
	title: string;
	source: string;
	size: number;
};
export type MemoryCategory = "all" | "text" | "images" | "files" | "chats";
export const MEMORY_CATEGORIES: { id: MemoryCategory; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "text", label: "Text" },
	{ id: "images", label: "Images" },
	{ id: "files", label: "Files" },
	{ id: "chats", label: "Chats" },
];
export const memoryCategory = (
	item: MemoryItem,
): Exclude<MemoryCategory, "all"> =>
	item.kind === "source"
		? "chats"
		: item.kind === "note"
			? "text"
			: item.kind === "image"
				? "images"
				: "files";
/** The icon drawn for each kind of memory (24×24 stroke paths). */
export const memoryIconPath = (item: MemoryItem) => {
	if (item.kind === "source")
		return item.source.startsWith("run:")
			? "M8 5v14l11-7z"
			: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z";
	if (item.kind === "note") return "M14 3H6v18h12V7z M14 3v4h4 M9 12h6 M9 16h6";
	const ext = item.title.split(".").pop()?.toLowerCase() ?? "";
	if (["mp4", "mov", "webm"].includes(ext))
		return "M3 5h18v14H3z M10 9l5 3-5 3z";
	if (["mp3", "wav", "m4a"].includes(ext))
		return "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";
	if (ext === "pdf") return "M14 3H6v18h12V7z M14 3v4h4 M8.5 15h7 M8.5 18h4";
	return "M14 3H6v18h12V7z M14 3v4h4";
};
export const memoryKindLabel = (item: MemoryItem) =>
	item.kind === "source"
		? item.source.startsWith("run:")
			? "Run"
			: "Chat"
		: item.kind === "note"
			? "Note"
			: item.kind === "image"
				? "Image"
				: "File";
export const memoryOriginLabel = (item: MemoryItem) =>
	item.source.startsWith("chat:")
		? "A chat in this project"
		: item.source.startsWith("run:")
			? "An automation run"
			: item.source === "dropped"
				? "Dropped in"
				: item.source === "agent"
					? "Saved by an agent"
					: "Written here";
export const formatBytes = (size: number) =>
	size >= 1_000_000
		? `${(size / 1_000_000).toFixed(1)} MB`
		: `${Math.max(1, Math.round(size / 1000))} KB`;
export const clampZoom = (k: number) => Math.min(4, Math.max(0.2, k));
/** First message for a chat that continues from a session, carrying what was saved from it. */
export const continuationDraft = (
	chat: string,
	notes: string[],
	files: string[],
) =>
	[
		`Continue from the chat “${chat}”. These memories were saved from it:`,
		...notes,
		files.length ? `Files saved from it: ${files.join(", ")}` : "",
		"Use them as context, and search project memory for anything related before answering.",
	]
		.filter(Boolean)
		.join("\n\n");
