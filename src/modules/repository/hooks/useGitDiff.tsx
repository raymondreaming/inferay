import { useQuery } from "@octanejs/tanstack-query";
import { queryClient } from "../../../shared/lib/data.ts";

import type { DiffRequest, HunkDiff } from "../model/types.ts";

export function useGitDiff(request: DiffRequest | null = null) {
	const key = JSON.stringify(request);
	const query = useQuery(
		{
			queryKey: ["git-diff", request?.cwd, key],
			enabled: request !== null,
			gcTime: 0,
			staleTime: 0,
			retry: false,
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				const req = request!;
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
				return (await response.json()) as HunkDiff;
			},
		},
		queryClient,
	);
	return {
		diff: request && !query.error ? (query.data ?? null) : null,
		error: request ? query.error?.message : undefined,
		request,
		loading: request !== null && query.isPending,
	};
}
