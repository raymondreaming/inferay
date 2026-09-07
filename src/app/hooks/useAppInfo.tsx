import type { AppInfo } from "../../../build/presentation/contracts/AppInfo.ts";
import { useQueryResource } from "../../shared/hooks/useQueryResource.tsx";
import { fetchJsonOr } from "../../shared/lib/native.tsx";

const FALLBACK_APP_INFO: AppInfo = {
	name: "inferay",
	version: "dev",
	channel: "dev",
	production: false,
	update: {
		available: false,
		currentVersion: "dev",
		latestVersion: null,
		url: null,
	},
};
function fetchAppInfo() {
	return fetchJsonOr("/api/app-info", FALLBACK_APP_INFO);
}
export function useAppInfo() {
	return useQueryResource<AppInfo>(
		() => fetchAppInfo,
		() => FALLBACK_APP_INFO,
		() => ({
			queryKey: ["app-info"],
		}),
	);
}
