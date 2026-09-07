import type { QueryKey } from "@tanstack/solid-query";
import { type Accessor, createMemo } from "solid-js";
import type { StateUpdate } from "../lib/dom.tsx";
import { queryClient } from "../lib/dom.tsx";

interface QueryResourceOptions {
	readonly enabled?: boolean;
	readonly gcTime?: number;
	readonly queryKey: QueryKey;
	readonly refetchInterval?: number;
	readonly staleTime?: number;
}
export function useQueryResource<T>(
	_fetcher: Accessor<(signal?: AbortSignal) => Promise<T> | null>,
	_initialData: Accessor<T>,
	_options: Accessor<QueryResourceOptions>,
) {
	const query = useBackgroundQuery(
		() => {
			const _optionsValue = _options();
			const fetcher = _fetcher();
			const initialData = _initialData();
			return {
				..._optionsValue,
				queryFn: async ({ signal }) => (await fetcher(signal)) ?? initialData,
				initialData,
				// Initial data is a render-safe placeholder, not a completed request.
				// Mark it stale so queries with a positive staleTime still fetch once.
				initialDataUpdatedAt: 0,
				enabled: _optionsValue.enabled ?? true,
			};
		},
		() => queryClient,
	);
	const refetchQuery = createMemo(() => query.refetch);
	const setData = (value: StateUpdate<T>) => {
		queryClient.setQueryData<T>(_options().queryKey, (previous) => {
			const current = previous ?? _initialData();
			return typeof value === "function"
				? (value as (current: T) => T)(current)
				: value;
		});
	};
	const refresh = async () => {
		const result = await refetchQuery()();
		return result.data ?? _initialData();
	};
	// Background fetches must not hold unrelated UI updates. Keep the last
	// available data visible and expose fetching/error state independently.
	return {
		get data() {
			return query.data ?? _initialData();
		},
		get error() {
			return query.error instanceof Error ? query.error.message : null;
		},
		get loaded() {
			return query.isFetched;
		},
		get loading() {
			return query.isFetching;
		},
		refresh,
		setData,
	};
}
export function usePollingQuery<T>(
	_fetcher2: Accessor<(signal?: AbortSignal) => Promise<T>>,
	_pollInterval: Accessor<number>,
	_initialData2: Accessor<T>,
	_options2: Accessor<Omit<QueryResourceOptions, "refetchInterval">>,
) {
	return useQueryResource(
		() => _fetcher2(),
		() => _initialData2(),
		() => {
			const _options2Value = _options2(),
				_pollIntervalValue = _pollInterval();
			return {
				..._options2Value,
				refetchInterval: _pollIntervalValue,
				staleTime: Math.min(
					_pollIntervalValue,
					_options2Value.staleTime ?? _pollIntervalValue,
				),
			};
		},
	);
}

import {
	type DefaultError,
	type QueryClient,
	QueryObserver,
	type QueryObserverOptions,
	type QueryObserverResult,
} from "@tanstack/query-core";
import { createEffect, createStore, onSettled, untrack } from "solid-js";

/** Queries with explicit loading/error UI must never suspend the workspace.
 * Keep TanStack's cache, cancellation and placeholder behavior, and publish
 * observer snapshots through a shallow Solid store instead of async reads.
 */
export function useBackgroundQuery<
	TQueryFnData = unknown,
	TError = DefaultError,
	TData = TQueryFnData,
	TQueryKey extends QueryKey = QueryKey,
>(
	options: Accessor<
		QueryObserverOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>
	>,
	client: Accessor<QueryClient>,
): QueryObserverResult<TData, TError> {
	const observer = new QueryObserver(untrack(client), untrack(options));
	type Snapshot = {
		[K in keyof QueryObserverResult<TData, TError>]: QueryObserverResult<
			TData,
			TError
		>[K];
	};
	const [result, setResult] = createStore<Snapshot>(
		observer.getCurrentResult(),
		{ shallow: true },
	);
	// Subscribing may synchronously publish a fetching snapshot. Start it in
	// the imperative lifecycle phase, never during component construction.
	onSettled(() =>
		observer.subscribe((next) =>
			setResult((draft) => {
				Object.assign(draft, next);
			}),
		),
	);
	createEffect(options, (next) => observer.setOptions(next));
	return result as QueryObserverResult<TData, TError>;
}
