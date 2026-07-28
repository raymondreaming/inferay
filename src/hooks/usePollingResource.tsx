import { useCallback, useEffect, useRef, useState } from "octane";

function isAbortLikeError(error: unknown): boolean {
	if (error instanceof DOMException) return error.name === "AbortError";
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			error.name === "AbortError" ||
			message.includes("aborted") ||
			message.includes("load failed")
		);
	}
	return false;
}

export function usePollingResource<T>(
	fetcher: (signal?: AbortSignal) => Promise<T>,
	pollInterval: number,
	initialValue: T,
	options?: {
		deferInitialFetch?: boolean;
		enabled?: boolean;
		isEqual?: (prev: T, next: T) => boolean;
	}
) {
	const [data, setData] = useState(initialValue);
	const [loaded, setLoaded] = useState(false);
	const mountedRef = useRef(true);
	const dataRef = useRef(data);
	const deferInitialFetch = options?.deferInitialFetch ?? false;
	const enabled = options?.enabled ?? true;
	const enabledRef = useRef(enabled);
	const requestVersionRef = useRef(0);
	dataRef.current = data;
	enabledRef.current = enabled;
	const isEqualRef = useRef(options?.isEqual);
	isEqualRef.current = options?.isEqual;
	const refetch = useCallback(
		async (signal?: AbortSignal) => {
			if (!enabledRef.current) return dataRef.current;
			const requestVersion = requestVersionRef.current;
			try {
				const next = await fetcher(signal);
				if (
					mountedRef.current &&
					enabledRef.current &&
					requestVersion === requestVersionRef.current
				) {
					setData((prev) => {
						if (isEqualRef.current?.(prev, next)) return prev;
						dataRef.current = next;
						return next;
					});
					setLoaded(true);
				}
				return next;
			} catch (error) {
				if (signal?.aborted || isAbortLikeError(error)) {
					return dataRef.current;
				}
				throw error;
			}
		},
		[fetcher]
	);
	useEffect(() => {
		mountedRef.current = true;
		const effectVersion = ++requestVersionRef.current;
		if (!enabled) {
			return () => {
				mountedRef.current = false;
				if (requestVersionRef.current === effectVersion) {
					requestVersionRef.current++;
				}
			};
		}
		const controller = new AbortController();
		let initialFetchFrame: number | null = null;
		// Defer initial fetch to next frame to avoid blocking render
		if (deferInitialFetch) {
			initialFetchFrame = requestAnimationFrame(() => {
				initialFetchFrame = null;
				if (
					mountedRef.current &&
					enabledRef.current &&
					requestVersionRef.current === effectVersion
				) {
					void refetch(controller.signal);
				}
			});
		} else {
			void refetch(controller.signal);
		}
		const interval = window.setInterval(() => {
			void refetch(controller.signal);
		}, pollInterval);
		return () => {
			mountedRef.current = false;
			if (requestVersionRef.current === effectVersion) {
				requestVersionRef.current++;
			}
			if (initialFetchFrame !== null) {
				cancelAnimationFrame(initialFetchFrame);
			}
			controller.abort();
			window.clearInterval(interval);
		};
	}, [pollInterval, refetch, deferInitialFetch, enabled]);
	return { data, setData, refetch, mountedRef, loaded };
}
