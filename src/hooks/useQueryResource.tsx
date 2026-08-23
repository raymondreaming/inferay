import {
	type QueryKey,
	useQuery,
	useQueryClient,
} from "@octanejs/tanstack-query";
import { useCallback } from "octane";
import type { SetStateAction } from "react";
import { queryClient } from "../lib/query-client.ts";

interface QueryResourceOptions<T> {
	readonly enabled?: boolean;
	readonly isEqual?: (previous: T, next: T) => boolean;
	readonly queryKey: QueryKey;
	readonly refetchInterval?: number;
	readonly staleTime?: number;
}

export function useQueryResource<T>(
	fetcher: () => Promise<T> | null,
	initialData: T,
	options: QueryResourceOptions<T>,
) {
	const client = useQueryClient(queryClient);
	const query = useQuery(
		{
			queryKey: options.queryKey,
			queryFn: async () => (await fetcher()) ?? initialData,
			initialData,
			enabled: options.enabled ?? true,
			refetchInterval: options.refetchInterval,
			staleTime: options.staleTime,
			structuralSharing: (previous, next) =>
				previous !== undefined && options.isEqual?.(previous as T, next as T)
					? (previous as T)
					: (next as T),
		},
		queryClient,
	);

	const setData = useCallback(
		(value: SetStateAction<T>) => {
			client.setQueryData<T>(options.queryKey, (previous) => {
				const current = previous ?? initialData;
				const next =
					typeof value === "function"
						? (value as (current: T) => T)(current)
						: value;
				return options.isEqual?.(current, next) ? current : next;
			});
		},
		[client, initialData, options.isEqual, options.queryKey],
	);

	const refresh = useCallback(async () => {
		const result = await query.refetch();
		return result.data ?? initialData;
	}, [initialData, query]);

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
	options: Omit<QueryResourceOptions<T>, "refetchInterval">,
) {
	return useQueryResource(() => fetcher(), initialData, {
		...options,
		refetchInterval: pollInterval,
		staleTime: Math.min(pollInterval, options.staleTime ?? pollInterval),
	});
}
