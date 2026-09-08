import { type Accessor, createMemo, onSettled } from "solid-js";
import type { HunkDiff } from "../../../../build/presentation/contracts/HunkDiff.ts";
import { useBackgroundQuery as useQuery } from "../../../shared/hooks/useQueryResource.tsx";
import { prefetchSyntaxPreview } from "../../../shared/hooks/useSyntaxHighlight.tsx";
import { queryClient } from "../../../shared/lib/dom.tsx";
export function useGitDiff(
	_request: Accessor<DiffRequest | null> = () => null,
) {
	const key = createMemo(() => {
		const _requestValue = _request();
		return _requestValue
			? JSON.stringify({ ..._requestValue, revision: undefined })
			: "";
	});
	const query = useQuery(
		() => {
			const _requestValue2 = _request();
			const identity = key();
			return {
				queryKey: _requestValue2
					? diffQueryKey(_requestValue2)
					: ["git-diff", null],
				placeholderData: (previous, previousQuery) =>
					previousQuery?.queryKey[2] === identity ? previous : undefined,
				enabled: _requestValue2 !== null,
				// Paint recently visited diffs immediately while checking for changes.
				gcTime: 30_000,
				staleTime: 0,
				retry: false,
				queryFn: ({ signal }: { signal: AbortSignal }) =>
					fetchGitDiff(_requestValue2!, signal),
			};
		},
		() => queryClient,
	);
	return {
		get diff() {
			const _requestValue3 = _request();
			return _requestValue3 && !query.error ? (query.data ?? null) : null;
		},
		get error() {
			const _requestValue3 = _request();
			return _requestValue3 ? query.error?.message : undefined;
		},
		get request() {
			const _requestValue3 = _request();
			return _requestValue3;
		},
		get loading() {
			const _requestValue3 = _request();
			return _requestValue3 !== null && query.isPending;
		},
	};
}
export interface DiffRequest {
	cwd: string;
	revision?: string;
	file: string;
	staged: boolean;
	commitHash?: string;
	commitParent?: string;
	comparisonFrom?: string;
	comparisonTo?: string;
	view?: "full" | "review";
}
export async function fetchGitDiff(
	request: DiffRequest,
	signal: AbortSignal,
): Promise<HunkDiff> {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(request))
		if (value !== undefined) query.set(key, String(value));
	const response = await fetch(`/api/git/diff?${query}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
	});
	if (!response.ok)
		throw new Error(`Diff request failed (HTTP ${response.status})`);
	const diff = (await response.json()) as HunkDiff;
	// Prepare the initial viewport; mounted panels classify the rest in the background.
	await prefetchDiffSyntax(request, diff);
	signal.throwIfAborted();
	return diff;
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
