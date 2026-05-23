import { fetchJsonOr } from "../lib/fetch-json.ts";
import { useAsyncResource } from "./useAsyncResource.ts";

export interface AppInfo {
	name: string;
	version: string;
	hash?: string;
	channel: string;
	identifier?: string;
	production: boolean;
}

export const FALLBACK_APP_INFO: AppInfo = {
	name: "inferay",
	version: "dev",
	channel: "dev",
	production: false,
};

export function useAppInfo() {
	return useAsyncResource<AppInfo>(
		() => fetchJsonOr("/api/app-info", FALLBACK_APP_INFO),
		FALLBACK_APP_INFO,
		[]
	);
}
