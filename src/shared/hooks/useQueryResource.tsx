import {
	type DefaultError,
	QueryObserver,
	type QueryObserverOptions,
	type QueryObserverResult,
} from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/solid-query";
import {
	type Accessor,
	createEffect,
	createMemo,
	createStore,
	onSettled,
	untrack,
} from "solid-js";
import type { StateUpdate } from "../lib/dom.tsx";
import { queryClient } from "../lib/dom.tsx";

export function useQueryResource<T>(
	options: Accessor<QueryObserverOptions<T> & { initialData: T }>,
) {
	const query = useBackgroundQuery<T>(() => ({
		// Fallback data must not suppress the initial request.
		initialDataUpdatedAt: 0,
		...options(),
	}));
	const refetchQuery = createMemo(() => query.refetch);
	const setData = (value: StateUpdate<T>) => {
		queryClient.setQueryData<T>(options().queryKey, (previous) => {
			const current = previous ?? options().initialData;
			return typeof value === "function"
				? (value as (current: T) => T)(current)
				: value;
		});
	};
	const refresh = async () => {
		const result = await refetchQuery()();
		return result.data ?? options().initialData;
	};
	// Background fetches must not hold unrelated UI updates. Keep the last
	// available data visible and expose fetching/error state independently.
	return {
		get data() {
			return query.data ?? options().initialData;
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
): QueryObserverResult<TData, TError> {
	const observer = new QueryObserver(queryClient, untrack(options));
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
