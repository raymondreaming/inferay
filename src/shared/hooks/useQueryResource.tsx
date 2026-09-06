import { type QueryKey, useQuery } from "@octanejs/tanstack-query";
import { useCallback } from "octane";
import type { SetStateAction } from "react";
import { queryClient } from "../lib/data.ts";

interface QueryResourceOptions {
	readonly enabled?: boolean;
	readonly gcTime?: number;
	readonly queryKey: QueryKey;
	readonly refetchInterval?: number;
	readonly staleTime?: number;
}

export function useQueryResource<T>(
	fetcher: (signal?: AbortSignal) => Promise<T> | null,
	initialData: T,
	options: QueryResourceOptions,
) {
	const query = useQuery(
		{
			...options,
			queryFn: async ({ signal }) => (await fetcher(signal)) ?? initialData,
			initialData,
			// Initial data is a render-safe placeholder, not a completed request.
			// Mark it stale so queries with a positive staleTime still fetch once.
			initialDataUpdatedAt: 0,
			enabled: options.enabled ?? true,
		},
		queryClient,
	);
	const refetchQuery = query.refetch;

	const setData = useCallback(
		(value: SetStateAction<T>) => {
			queryClient.setQueryData<T>(options.queryKey, (previous) => {
				const current = previous ?? initialData;
				return typeof value === "function"
					? (value as (current: T) => T)(current)
					: value;
			});
		},
		[initialData, options.queryKey],
	);

	const refresh = useCallback(async () => {
		const result = await refetchQuery();
		return result.data ?? initialData;
	}, [initialData, refetchQuery]);

	return {
		data: query.data ?? initialData,
		error: query.error instanceof Error ? query.error.message : null,
		loaded: query.isFetched,
		loading: query.isFetching,
		refetch: refresh,
		refresh,
		setData,
	};
}

export function usePollingQuery<T>(
	fetcher: (signal?: AbortSignal) => Promise<T>,
	pollInterval: number,
	initialData: T,
	options: Omit<QueryResourceOptions, "refetchInterval">,
) {
	return useQueryResource(fetcher, initialData, {
		...options,
		refetchInterval: pollInterval,
		staleTime: Math.min(pollInterval, options.staleTime ?? pollInterval),
	});
}
