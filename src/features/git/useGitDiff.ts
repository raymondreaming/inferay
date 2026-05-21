import { useCallback, useRef, useState } from "react";

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
export const MAX_DIFF_TOKENIZE_LINE_CHARS = 1000;

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
	maxChars = MAX_DIFF_TOKENIZE_LINE_CHARS
): boolean {
	for (const line of patch.split("\n")) {
		if (line.length > maxChars) return true;
	}
	return false;
}

export function shouldDisableDiffTokenization(diff: HunkDiff): boolean {
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
	end: number
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

export function summarizeHunkDiff(diff: HunkDiff | null): HunkDiffStats {
	if (!diff) return { added: 0, removed: 0, hunks: 0, lines: 0 };
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
const diffCache = new Map<string, { diff: HunkDiff; storedAt: number }>();

function diffCacheKey(req: DiffRequest): string {
	return `${req.cwd}\0${req.file}\0${req.staged ? "staged" : "unstaged"}`;
}

// Hook for loading and managing git diff state
export function useGitDiff() {
	const [loading, setLoading] = useState(false);
	const [diff, setDiff] = useState<HunkDiff | null>(null);
	const [request, setRequest] = useState<DiffRequest | null>(null);
	const activeId = useRef(0);

	const loadDiff = useCallback((req: DiffRequest) => {
		const id = ++requestCounter;
		const controller = new AbortController();
		const timeout = setTimeout(controller.abort.bind(controller), 12000);
		const cacheKey = diffCacheKey(req);
		const cached = diffCache.get(cacheKey);
		const canUseCached =
			cached && Date.now() - cached.storedAt <= DIFF_CACHE_TTL_MS;
		activeId.current = id;
		setRequest(req);
		setLoading(!canUseCached);
		if (canUseCached) {
			setDiff(cached.diff);
		}

		fetch(
			`/api/git/full-diff?cwd=${encodeURIComponent(req.cwd)}&file=${encodeURIComponent(req.file)}&staged=${req.staged}`,
			{ signal: controller.signal }
		)
			.then((resp) => {
				if (activeId.current !== id) return null;
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				return resp.json();
			})
			.then((result) => {
				if (activeId.current !== id || !result) return;
				const nextDiff = isHunkDiff(result)
					? result
					: safeDiffMessage("Diff response could not be rendered safely");
				diffCache.set(cacheKey, { diff: nextDiff, storedAt: Date.now() });
				setDiff(nextDiff);
				setLoading(false);
			})
			.catch(() => {
				if (activeId.current !== id) return;
				setDiff(
					safeDiffMessage("Diff timed out before it could render safely")
				);
				setLoading(false);
			})
			.finally(() => {
				clearTimeout(timeout);
			});
	}, []);

	// Clear current diff state
	const clear = useCallback(() => {
		activeId.current = ++requestCounter;
		setDiff(null);
		setRequest(null);
		setLoading(false);
	}, []);

	return { diff, request, loading, loadDiff, clear };
}
