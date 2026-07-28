import { useCallback, useEffect, useRef, useState } from "octane";
import type { SetStateAction } from "react";

/**
 * Generic async resource hook. Tracks loading/error state for an arbitrary
 * fetcher and re-runs whenever `deps` change. Return `null` from `fetcher`
 * to indicate "no input yet" (skips loading state).
 */
export function useAsyncResource<T>(
	fetcher: () => Promise<T> | null,
	initial: T,
	options?: { isEqual?: (prev: T, next: T) => boolean }
) {
	const [data, setDataState] = useState<T>(initial);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const initialRef = useRef(initial);
	const isEqualRef = useRef(options?.isEqual);

	initialRef.current = initial;
	isEqualRef.current = options?.isEqual;

	const setData = useCallback((value: SetStateAction<T>) => {
		setDataState((prev) => {
			const next =
				typeof value === "function"
					? (value as (current: T) => T)(prev)
					: value;
			if (isEqualRef.current?.(prev, next)) return prev;
			return next;
		});
	}, []);

	const refresh = useCallback(async () => {
		const promise = fetcher();
		if (!promise) {
			setData(initialRef.current);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			setData(await promise);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
			setData(initialRef.current);
		} finally {
			setLoading(false);
		}
	}, [fetcher, setData]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return { data, setData, loading, error, refresh };
}
