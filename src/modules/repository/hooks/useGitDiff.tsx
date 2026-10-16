import type { DiffRequest, HunkDiff } from "@contracts";
import {
	type GitDiffResponse,
	loadGitDiff,
} from "@repository/services/gitApi.ts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { prefetchSyntaxPreview } from "@shared/hooks/useSyntaxHighlight.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { type Accessor, onSettled } from "solid-js";

export function useGitDiff(
	_request: Accessor<DiffRequest | null> = () => null,
) {
	const query = useQuery(() => {
		const request = _request();
		const queryKey = request ? diffQueryKey(request) : ["git-diff", null];
		return {
			queryKey,
			placeholderData: (previous, previousQuery) =>
				previousQuery?.queryKey[2] === queryKey[2] ? previous : undefined,
			enabled: request !== null,
			// Paint recently visited diffs immediately while checking for changes.
			gcTime: 30_000,
			staleTime: 0,
			retry: false,
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				fetchGitDiff(request!, signal),
		};
	});
	return {
		get diff() {
			return _request() && !query.error ? (query.data?.diff ?? null) : null;
		},
		get error() {
			return _request() ? query.error?.message : undefined;
		},
		get request() {
			return _request();
		},
		get loading() {
			return _request() !== null && query.isPending;
		},
	};
}
async function fetchGitDiff(
	input: DiffRequest,
	signal: AbortSignal,
): Promise<GitDiffResponse> {
	const startedAt = Date.now();
	const queryKey = diffQueryKey(input).slice(0, 3);
	const cached = queryClient
		.getQueryCache()
		.findAll({ queryKey })
		.filter((query) => query.state.data !== undefined)
		.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
	const previous = cached
		? queryClient.getQueryData<GitDiffResponse>(cached.queryKey)
		: undefined;
	const response = await loadGitDiff(input, signal, previous);
	signal.throwIfAborted();
	// Keep other files warm, but release superseded snapshots of this diff.
	// Live viewers, pending reads and results newer than this request stay owned.
	queryClient.removeQueries({
		queryKey,
		type: "inactive",
		predicate: (query) =>
			query.getObserversCount() === 0 &&
			query.queryKey[3] !== input.revision &&
			query.state.fetchStatus === "idle" &&
			query.state.dataUpdatedAt <= startedAt,
	});
	if (response !== previous) void prefetchDiffSyntax(input, response.diff);
	return response;
}

async function prefetchDiffSyntax(request: DiffRequest, diff: HunkDiff) {
	if (diff.isBinary || diff.metadata.tokenizationDisabled) return;
	const panels = diff.conflictLines
		? [diff.conflictLines]
		: request.view === "review"
			? [diff.inlineLines ?? diff.compactLines ?? []]
			: [diff.isNew ? [] : diff.oldLines, diff.newLines];
	// Working-tree split views start at the first change. History starts at the top.
	const initialEnd =
		request.view !== "review" && !request.commitHash && !request.comparisonFrom
			? (diff.metadata.splitChangeRanges[0]?.[0] ?? 0) + 200
			: 200;
	await Promise.all(
		panels.map((lines) =>
			prefetchSyntaxPreview(
				{
					filePath: request.file,
					lines: lines.map((line) => line.content),
					lineTypes: lines.map((line) => line.type),
				},
				initialEnd,
			),
		),
	);
}

function diffQueryKey(request: DiffRequest) {
	return [
		"git-diff",
		request.cwd,
		JSON.stringify({ ...request, revision: undefined }),
		request.revision,
	];
}

/** Speculative transport shares the foreground cache. One running request and
 * a replaceable, bounded queue prevent pointer sweeps from flooding Git. */
export function useDiffPrefetch() {
	let pending: DiffRequest[] = [];
	let running = false;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const drain = async () => {
		if (running || disposed) return;
		running = true;
		try {
			while (!disposed && pending.length) {
				const request = pending.shift()!;
				await queryClient.prefetchQuery({
					queryKey: diffQueryKey(request),
					queryFn: ({ signal }) => fetchGitDiff(request, signal),
					staleTime: 10_000,
					gcTime: 30_000,
					retry: false,
				});
			}
		} finally {
			running = false;
		}
	};
	onSettled(() => () => {
		disposed = true;
		pending = [];
		clearTimeout(timer);
	});
	return (requests: DiffRequest[]) => {
		clearTimeout(timer);
		pending = [];
		timer = setTimeout(() => {
			pending = requests.slice(0, 3);
			void drain();
		}, 80);
	};
}
