declare module "@octanejs/remix-router" {
	import type { ComponentBody } from "octane";

	export interface Location {
		hash: string;
		key: string;
		pathname: string;
		search: string;
		state: unknown;
	}

	export interface NavigateOptions {
		replace?: boolean;
		state?: unknown;
	}

	export type NavigateFunction = (
		to: string | number,
		options?: NavigateOptions
	) => void | Promise<void>;

	export const HashRouter: ComponentBody<{ children: unknown }>;
	export const Navigate: ComponentBody<{
		to: string;
		replace?: boolean;
		state?: unknown;
	}>;
	export const Route: ComponentBody<{
		path?: string;
		element?: unknown;
		children?: unknown;
	}>;
	export const Routes: ComponentBody<{ children: unknown }>;

	export function useLocation(): Location;
	export function useNavigate(): NavigateFunction;
}
