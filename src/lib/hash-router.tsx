import { useCallback, useEffect, useSyncExternalStore } from "octane";

export interface HashLocation {
	readonly hash: string;
	readonly key: string;
	readonly pathname: string;
	readonly search: string;
	readonly state: unknown;
}

export interface NavigateOptions {
	readonly replace?: boolean;
	readonly state?: unknown;
}

export type NavigateFunction = (
	to: string | number,
	options?: NavigateOptions
) => void;

const HASH_NAVIGATION_EVENT = "inferay-hash-navigation";
let cachedHref = "";
let cachedState: unknown;
let cachedLocation: HashLocation | null = null;

function readHashLocation(): HashLocation {
	const href = window.location.href;
	const state = window.history.state;
	if (cachedLocation && cachedHref === href && cachedState === state) {
		return cachedLocation;
	}

	const raw = window.location.hash.slice(1) || "/";
	const queryIndex = raw.indexOf("?");
	const pathname = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
	const search = queryIndex >= 0 ? raw.slice(queryIndex) : "";
	cachedHref = href;
	cachedState = state;
	cachedLocation = {
		hash: window.location.hash,
		key: window.location.hash || "/",
		pathname: pathname.startsWith("/") ? pathname : `/${pathname}`,
		search,
		state,
	};
	return cachedLocation;
}

function subscribeToHashNavigation(listener: () => void) {
	window.addEventListener("hashchange", listener);
	window.addEventListener("popstate", listener);
	window.addEventListener(HASH_NAVIGATION_EVENT, listener);
	return () => {
		window.removeEventListener("hashchange", listener);
		window.removeEventListener("popstate", listener);
		window.removeEventListener(HASH_NAVIGATION_EVENT, listener);
	};
}

function navigateHash(to: string | number, options: NavigateOptions = {}) {
	if (typeof to === "number") {
		window.history.go(to);
		return;
	}

	const target = to.startsWith("/") ? to : `/${to}`;
	const url = `${window.location.pathname}${window.location.search}#${target}`;
	const method = options.replace ? "replaceState" : "pushState";
	window.history[method](options.state ?? null, "", url);
	window.dispatchEvent(new Event(HASH_NAVIGATION_EVENT));
}

export function useLocation(): HashLocation {
	return useSyncExternalStore(
		subscribeToHashNavigation,
		readHashLocation,
		readHashLocation
	);
}

export function useNavigate(): NavigateFunction {
	return useCallback(navigateHash, []);
}

export function Navigate({
	to,
	replace = false,
	state,
}: {
	readonly to: string;
	readonly replace?: boolean;
	readonly state?: unknown;
}) {
	useEffect(() => navigateHash(to, { replace, state }), [replace, state, to]);
	return null;
}
