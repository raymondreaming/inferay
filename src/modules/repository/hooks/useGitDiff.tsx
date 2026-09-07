import { useQuery } from "@octanejs/tanstack-query";
import type { HunkDiff } from "../../../../build/presentation/contracts/HunkDiff.ts";
import { queryClient } from "../../../shared/lib/data.ts";

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
	return (await response.json()) as HunkDiff;
}
