import { useQuery } from "@octanejs/tanstack-query";
import { queryClient } from "../../../shared/lib/data.ts";

import { fetchGitDiff } from "../model/git-graph.ts";
import type { DiffRequest } from "../model/types.ts";

export function useGitDiff(request: DiffRequest | null = null) {
	const key = request ? JSON.stringify(request) : "";
	const query = useQuery(
		{
			queryKey: ["git-diff", request?.cwd, key],
			enabled: request !== null,
			gcTime: 0,
			staleTime: 0,
			retry: false,
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				fetchGitDiff(request!, signal),
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
