import type { AppInfo } from "@contracts";
import { fetchJsonOr } from "@shared/lib/native.tsx";

export const FALLBACK_APP_INFO: AppInfo = {
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

export function loadAppInfo() {
	return fetchJsonOr("/api/app-info", FALLBACK_APP_INFO);
}
