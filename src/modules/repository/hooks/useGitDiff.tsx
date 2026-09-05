import { useQuery } from "@octanejs/tanstack-query";
import { useMemo } from "octane";
import { ByteCache } from "../../../shared/lib/byte-cache.ts";
import { queryClient } from "../../../shared/lib/query-client.ts";

import type { DiffLine, DiffRequest, HunkDiff } from "../model/types.ts";

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

function isChangeRanges(value: unknown, rowCount: number): boolean {
	if (value === undefined) return true; // Older native responses remain readable.
	if (!Array.isArray(value)) return false;
	let previousEnd = -1;
	return value.every((range) => {
		if (!Array.isArray(range) || range.length !== 2) return false;
		const [start, end] = range;
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < 0 ||
			start <= previousEnd ||
			end <= start ||
			end > rowCount
		)
			return false;
		previousEnd = end;
		return true;
	});
}

function isMetadata(
	value: unknown,
): value is NonNullable<HunkDiff["metadata"]> {
	if (!value || typeof value !== "object") return false;
	const metadata = value as NonNullable<HunkDiff["metadata"]>;
	return (
		typeof metadata.tokenizationDisabled === "boolean" &&
		Number.isFinite(metadata.maxOldLineChars) &&
		Number.isFinite(metadata.maxNewLineChars) &&
		[metadata.maxInlineLineChars, metadata.maxConflictLineChars].every(
			(value) => value === undefined || (Number.isFinite(value) && value >= 0),
		) &&
		!!metadata.stats &&
		[
			metadata.stats.added,
			metadata.stats.removed,
			metadata.stats.hunks,
			metadata.stats.lines,
		].every((value) => Number.isFinite(value) && value >= 0)
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
		(diff.metadata === undefined || isMetadata(diff.metadata)) &&
		(diff.conflictLines === undefined ||
			(Array.isArray(diff.conflictLines) &&
				diff.conflictLines.every(isDiffLine))) &&
		(diff.inlineLines === undefined ||
			(Array.isArray(diff.inlineLines) &&
				diff.inlineLines.every(isDiffLine))) &&
		(diff.compactLines === undefined ||
			(Array.isArray(diff.compactLines) &&
				diff.compactLines.every(isDiffLine))) &&
		isChangeRanges(
			diff.metadata?.splitChangeRanges,
			Math.max(diff.oldLines.length, diff.newLines.length),
		) &&
		isChangeRanges(
			diff.metadata?.inlineChangeRanges,
			(diff.inlineLines ?? diff.compactLines ?? []).length,
		) &&
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
		inlineLines: [{ number: 1, content, type: "context" }],
		newLines: [{ number: 1, content, type: "context" }],
		isBinary: false,
		isNew: false,
	};
}

const DIFF_CACHE_TTL_MS = 60_000;
const MAX_DIFF_CACHE_ENTRIES = 100;
const diffCache = new ByteCache<{ diff: HunkDiff; storedAt: number }>(
	32 * 1024 * 1024,
	MAX_DIFF_CACHE_ENTRIES,
);

function isHistoricalDiff(req: DiffRequest): boolean {
	const fullOid = (value?: string) =>
		!!value && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
	return req.comparisonFrom || req.comparisonTo
		? fullOid(req.comparisonFrom) && fullOid(req.comparisonTo)
		: fullOid(req.commitHash) &&
				(!req.commitParent || fullOid(req.commitParent));
}

function diffBytes(diff: HunkDiff): number {
	let bytes =
		256 +
		(diff.rawPatch?.length ?? 0) * 2 +
		(diff.mergeConflictContent?.length ?? 0) * 2;
	for (const lines of [
		diff.oldLines,
		diff.newLines,
		diff.compactLines ?? [],
		diff.inlineLines ?? [],
		diff.conflictLines ?? [],
	]) {
		for (const line of lines) bytes += 96 + line.content.length * 2;
	}
	return bytes;
}

function diffCacheKey(req: DiffRequest): string {
	return `${req.cwd}\0${req.repositoryRevision ?? "no-revision"}\0${req.file}\0${req.staged ? "staged" : "unstaged"}\0${req.commitHash ?? "wip"}\0${req.commitParent ?? "default-parent"}\0${req.comparisonFrom ?? "no-comparison"}\0${req.comparisonTo ?? "no-comparison"}\0${req.view ?? "full"}`;
}

function storeCachedDiff(key: string, diff: HunkDiff) {
	diffCache.set(
		key,
		{ diff, storedAt: Date.now() },
		diffBytes(diff) + key.length * 2,
	);
}

// The shared query owner handles cancellation, coalescing and subscriptions.
// ByteCache retains only bounded reusable results; inactive queries retain none.
export function useGitDiff(request: DiffRequest | null = null) {
	const key = request ? diffCacheKey(request) : "disabled";
	const query = useQuery(
		{
			queryKey: ["git-diff", request?.cwd, key],
			enabled: request !== null,
			gcTime: 0,
			staleTime: request && isHistoricalDiff(request) ? DIFF_CACHE_TTL_MS : 0,
			retry: false,
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				const req = request!;
				const cached = diffCache.get(key);
				if (
					cached &&
					isHistoricalDiff(req) &&
					Date.now() - cached.storedAt <= DIFF_CACHE_TTL_MS
				)
					return cached.diff;
				const view = req.view ?? "full";
				const endpoint =
					req.comparisonFrom && req.comparisonTo
						? `/api/git/comparison-diff?cwd=${encodeURIComponent(req.cwd)}&from=${encodeURIComponent(req.comparisonFrom)}&to=${encodeURIComponent(req.comparisonTo)}&file=${encodeURIComponent(req.file)}&view=${view}`
						: req.commitHash
							? `/api/git/commit-diff?cwd=${encodeURIComponent(req.cwd)}&hash=${encodeURIComponent(req.commitHash)}&file=${encodeURIComponent(req.file)}&view=${view}${req.commitParent ? `&parent=${encodeURIComponent(req.commitParent)}` : ""}`
							: `/api/git/full-diff?cwd=${encodeURIComponent(req.cwd)}&file=${encodeURIComponent(req.file)}&staged=${req.staged}&view=${view}`;
				const response = await fetch(
					`${endpoint}&revision=${encodeURIComponent(req.repositoryRevision ?? "")}`,
					{
						signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
					},
				);
				if (!response.ok)
					throw new Error(`Diff request failed (HTTP ${response.status})`);
				const result: unknown = await response.json();
				if (!isHunkDiff(result))
					throw new Error("Diff response could not be rendered safely");
				if (isHistoricalDiff(req)) storeCachedDiff(key, result);
				return result;
			},
		},
		queryClient,
	);
	const errorDiff = useMemo(
		() => (query.error ? safeDiffMessage(query.error.message) : null),
		[query.error],
	);
	return {
		diff: request ? (errorDiff ?? query.data ?? null) : null,
		request,
		loading: request !== null && query.isPending,
	};
}
