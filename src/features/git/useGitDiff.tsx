import { useCallback, useEffect, useRef, useState } from "octane";

// Single line in a diff view
export interface DiffLine {
	number: number | null;
	content: string;
	type: "add" | "remove" | "context" | "spacer" | "hunk";
}

// Full diff result with aligned old/new lines
export interface HunkDiff {
	oldLines: DiffLine[];
	newLines: DiffLine[];
	compactLines?: DiffLine[];
	isBinary: boolean;
	isNew: boolean;
	isImage?: boolean;
	imagePath?: string;
	rawPatch?: string;
	mergeConflictContent?: string;
}

// Request parameters for loading a diff
export interface DiffRequest {
	cwd: string;
	file: string;
	staged: boolean;
	view?: "full" | "review";
}

export interface HunkDiffStats {
	added: number;
	removed: number;
	hunks: number;
	lines: number;
}

const EMPTY_SPACER_LINE: DiffLine = {
	number: null,
	content: "",
	type: "spacer",
};
const MAX_DIFF_TOKENIZE_LINE_CHARS = 1000;

export type SplitDiffRow = {
	index: number;
	oldLine: DiffLine;
	newLine: DiffLine;
	changeIdx: number | undefined;
	hunkLine: DiffLine | null;
	isChanged: boolean;
};

export function hasLongPatchLine(
	patch: string,
	maxChars = MAX_DIFF_TOKENIZE_LINE_CHARS,
): boolean {
	for (const line of patch.split("\n")) {
		if (line.length > maxChars) return true;
	}
	return false;
}

export function shouldDisableDiffTokenization(diff: HunkDiff): boolean {
	for (const line of diff.compactLines ?? []) {
		if (line.content.length > MAX_DIFF_TOKENIZE_LINE_CHARS) return true;
	}
	for (const line of diff.oldLines) {
		if (line.content.length > MAX_DIFF_TOKENIZE_LINE_CHARS) return true;
	}
	for (const line of diff.newLines) {
		if (line.content.length > MAX_DIFF_TOKENIZE_LINE_CHARS) return true;
	}
	return diff.rawPatch ? hasLongPatchLine(diff.rawPatch) : false;
}

export function buildSplitDiffRows(
	oldLines: DiffLine[],
	newLines: DiffLine[],
	changeLineMap: Map<number, number> | undefined,
	start: number,
	end: number,
): SplitDiffRow[] {
	const rows: SplitDiffRow[] = [];
	const max = Math.max(oldLines.length, newLines.length);
	const from = Math.max(0, start);
	const to = Math.min(max, end);

	for (let index = from; index < to; index++) {
		const oldLine = oldLines[index] ?? EMPTY_SPACER_LINE;
		const newLine = newLines[index] ?? EMPTY_SPACER_LINE;
		rows.push({
			index,
			oldLine,
			newLine,
			changeIdx: changeLineMap?.get(index),
			hunkLine:
				oldLine.type === "hunk"
					? oldLine
					: newLine.type === "hunk"
						? newLine
						: null,
			isChanged: oldLine.type === "remove" || newLine.type === "add",
		});
	}

	return rows;
}

export function buildMergeConflictLines(content: string): DiffLine[] {
	const lines = content.split(/\r?\n/);
	const result: DiffLine[] = [];
	let section: "base" | "current" | "incoming" = "base";
	let number = 1;

	for (const line of lines) {
		if (line.startsWith("<<<<<<<")) {
			section = "current";
			result.push({
				number: null,
				content: line.replace(/^<<<<<<<\s*/, "Current change: "),
				type: "hunk",
			});
			continue;
		}
		if (line.startsWith("=======")) {
			section = "incoming";
			result.push({ number: null, content: "Incoming change", type: "hunk" });
			continue;
		}
		if (line.startsWith(">>>>>>>")) {
			section = "base";
			result.push({
				number: null,
				content: line.replace(/^>>>>>>>\s*/, "End conflict: "),
				type: "hunk",
			});
			continue;
		}

		result.push({
			number: number++,
			content: line,
			type:
				section === "current"
					? "remove"
					: section === "incoming"
						? "add"
						: "context",
		});
	}

	return result;
}

function isDiffLine(value: unknown): value is DiffLine {
	if (!value || typeof value !== "object") return false;
	const line = value as Partial<DiffLine>;
	return (
		(line.number === null || typeof line.number === "number") &&
		typeof line.content === "string" &&
		(line.type === "add" ||
			line.type === "remove" ||
			line.type === "context" ||
			line.type === "spacer" ||
			line.type === "hunk")
	);
}

function isHunkDiff(value: unknown): value is HunkDiff {
	if (!value || typeof value !== "object") return false;
	const diff = value as Partial<HunkDiff>;
	return (
		Array.isArray(diff.oldLines) &&
		Array.isArray(diff.newLines) &&
		diff.oldLines.every(isDiffLine) &&
		diff.newLines.every(isDiffLine) &&
		(diff.compactLines === undefined ||
			(Array.isArray(diff.compactLines) &&
				diff.compactLines.every(isDiffLine))) &&
		typeof diff.isBinary === "boolean" &&
		typeof diff.isNew === "boolean" &&
		(diff.rawPatch === undefined || typeof diff.rawPatch === "string") &&
		(diff.mergeConflictContent === undefined ||
			typeof diff.mergeConflictContent === "string")
	);
}

function safeDiffMessage(content: string): HunkDiff {
	return {
		oldLines: [],
		newLines: [{ number: 1, content, type: "context" }],
		isBinary: false,
		isNew: false,
	};
}

function areDiffRequestsEqual(
	prev: DiffRequest | null,
	next: DiffRequest | null,
) {
	if (prev === next) return true;
	if (!prev || !next) return false;
	return (
		prev.cwd === next.cwd &&
		prev.file === next.file &&
		prev.staged === next.staged &&
		(prev.view ?? "full") === (next.view ?? "full")
	);
}

function areDiffLinesEqual(prev: DiffLine[], next: DiffLine[]) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (a.number !== b.number || a.content !== b.content || a.type !== b.type) {
			return false;
		}
	}
	return true;
}

function areHunkDiffsEqual(prev: HunkDiff | null, next: HunkDiff | null) {
	if (prev === next) return true;
	if (!prev || !next) return false;
	return (
		prev.isBinary === next.isBinary &&
		prev.isNew === next.isNew &&
		prev.isImage === next.isImage &&
		prev.imagePath === next.imagePath &&
		prev.rawPatch === next.rawPatch &&
		prev.mergeConflictContent === next.mergeConflictContent &&
		areDiffLinesEqual(prev.compactLines ?? [], next.compactLines ?? []) &&
		areDiffLinesEqual(prev.oldLines, next.oldLines) &&
		areDiffLinesEqual(prev.newLines, next.newLines)
	);
}

export function summarizeHunkDiff(diff: HunkDiff | null): HunkDiffStats {
	if (!diff) return { added: 0, removed: 0, hunks: 0, lines: 0 };
	if (diff.compactLines) {
		let added = 0;
		let removed = 0;
		let hunks = 0;
		let inChange = false;
		for (const line of diff.compactLines) {
			const changed = line.type === "add" || line.type === "remove";
			if (line.type === "add") added++;
			if (line.type === "remove") removed++;
			if (changed && !inChange) hunks++;
			inChange = changed;
		}
		return { added, removed, hunks, lines: diff.compactLines.length };
	}
	let added = 0;
	let removed = 0;
	let hunks = 0;
	let inChange = false;
	const max = Math.max(diff.oldLines.length, diff.newLines.length);

	for (let i = 0; i < max; i++) {
		const oldLine = diff.oldLines[i];
		const newLine = diff.newLines[i];
		const oldChanged = oldLine?.type === "remove";
		const newChanged = newLine?.type === "add";
		const changed = oldChanged || newChanged;

		if (oldChanged) removed++;
		if (newChanged) added++;
		if (changed && !inChange) {
			hunks++;
			inChange = true;
		} else if (!changed) {
			inChange = false;
		}
	}

	return { added, removed, hunks, lines: max };
}

// Counter to track and cancel stale requests
let requestCounter = 0;
const DIFF_CACHE_TTL_MS = 60_000;
const MAX_DIFF_CACHE_ENTRIES = 100;
const diffCache = new Map<string, { diff: HunkDiff; storedAt: number }>();

function diffCacheKey(req: DiffRequest): string {
	return `${req.cwd}\0${req.file}\0${req.staged ? "staged" : "unstaged"}\0${req.view ?? "full"}`;
}

function storeCachedDiff(key: string, diff: HunkDiff) {
	diffCache.delete(key);
	diffCache.set(key, { diff, storedAt: Date.now() });
	while (diffCache.size > MAX_DIFF_CACHE_ENTRIES) {
		const oldest = diffCache.keys().next().value;
		if (oldest === undefined) break;
		diffCache.delete(oldest);
	}
}

// Hook for loading and managing git diff state
export function useGitDiff(autoRequest: DiffRequest | null = null) {
	const [loading, setLoading] = useState(false);
	const [diffState, setDiffState] = useState<{
		key: string;
		diff: HunkDiff;
	} | null>(null);
	const [manualRequest, setManualRequest] = useState<DiffRequest | null>(null);
	const activeId = useRef(0);
	const activeAbort = useRef<AbortController | null>(null);
	const autoRequestRef = useRef(autoRequest);
	autoRequestRef.current = autoRequest;
	const autoKey = autoRequest ? diffCacheKey(autoRequest) : null;

	const startDiffLoad = useCallback(
		(req: DiffRequest, trackManual: boolean) => {
			const id = ++requestCounter;
			activeAbort.current?.abort();
			const controller = new AbortController();
			activeAbort.current = controller;
			const timeout = setTimeout(controller.abort.bind(controller), 12000);
			const cacheKey = diffCacheKey(req);
			const cached = diffCache.get(cacheKey);
			const canUseCached =
				cached && Date.now() - cached.storedAt <= DIFF_CACHE_TTL_MS;
			activeId.current = id;
			if (trackManual) {
				setManualRequest((current) =>
					areDiffRequestsEqual(current, req) ? current : req,
				);
			}
			setLoading(!canUseCached);
			if (canUseCached) {
				setDiffState((current) =>
					current?.key === cacheKey &&
					areHunkDiffsEqual(current.diff, cached.diff)
						? current
						: { key: cacheKey, diff: cached.diff },
				);
			}

			const view = req.view ?? "full";
			fetch(
				`/api/git/full-diff?cwd=${encodeURIComponent(req.cwd)}&file=${encodeURIComponent(req.file)}&staged=${req.staged}&view=${view}`,
				{ signal: controller.signal },
			)
				.then((resp) => {
					if (activeId.current !== id) return null;
					if (!resp.ok) {
						throw new Error(`Diff request failed (HTTP ${resp.status})`);
					}
					return resp.json();
				})
				.then((result) => {
					if (activeId.current !== id || !result) return;
					const nextDiff = isHunkDiff(result)
						? result
						: safeDiffMessage("Diff response could not be rendered safely");
					storeCachedDiff(cacheKey, nextDiff);
					setDiffState((current) =>
						current?.key === cacheKey &&
						areHunkDiffsEqual(current.diff, nextDiff)
							? current
							: { key: cacheKey, diff: nextDiff },
					);
					setLoading(false);
				})
				.catch((error: unknown) => {
					if (activeId.current !== id) return;
					const message = controller.signal.aborted
						? "Diff request exceeded 12 seconds"
						: error instanceof Error
							? error.message
							: "Diff could not be loaded";
					const nextDiff = safeDiffMessage(message);
					setDiffState((current) =>
						current?.key === cacheKey &&
						areHunkDiffsEqual(current.diff, nextDiff)
							? current
							: { key: cacheKey, diff: nextDiff },
					);
					setLoading(false);
				})
				.finally(() => {
					clearTimeout(timeout);
					if (activeId.current === id && activeAbort.current === controller) {
						activeAbort.current = null;
					}
				});
		},
		[],
	);

	const loadDiff = useCallback(
		(req: DiffRequest) => startDiffLoad(req, true),
		[startDiffLoad],
	);

	// Clear current diff state
	const clear = useCallback(() => {
		activeId.current = ++requestCounter;
		activeAbort.current?.abort();
		activeAbort.current = null;
		setDiffState(null);
		setManualRequest(null);
		setLoading(false);
	}, []);

	useEffect(() => {
		const request = autoRequestRef.current;
		if (!request || !autoKey) {
			activeId.current = ++requestCounter;
			activeAbort.current?.abort();
			activeAbort.current = null;
			return;
		}
		if (diffState?.key === autoKey) return;
		startDiffLoad(request, false);
	}, [autoKey, diffState?.key, startDiffLoad]);

	const visibleRequest = autoRequest ?? manualRequest;
	const visibleKey = visibleRequest ? diffCacheKey(visibleRequest) : null;
	const visibleDiff =
		visibleKey && diffState?.key === visibleKey ? diffState.diff : null;
	const visibleLoading = visibleRequest ? loading || !visibleDiff : loading;

	return {
		diff: visibleDiff,
		request: visibleRequest,
		loading: visibleLoading,
		loadDiff,
		clear,
	};
}
