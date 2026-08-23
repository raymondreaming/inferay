import { fetchJsonOr } from "../lib/fetch-json.ts";
import { useQueryResource } from "./useQueryResource.tsx";

export interface AppInfo {
	name: string;
	version: string;
	hash?: string;
	channel: string;
	identifier?: string;
	production: boolean;
	update: {
		available: boolean;
		currentVersion: string;
		latestVersion: string | null;
		url: string | null;
		checkedAt: number;
		error?: string;
	};
}

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
		checkedAt: 0,
	},
};

function fetchAppInfo() {
	return fetchJsonOr("/api/app-info", FALLBACK_APP_INFO);
}

function areAppInfoEqual(prev: AppInfo, next: AppInfo) {
	return (
		prev.name === next.name &&
		prev.version === next.version &&
		prev.hash === next.hash &&
		prev.channel === next.channel &&
		prev.identifier === next.identifier &&
		prev.production === next.production &&
		prev.update.available === next.update.available &&
		prev.update.currentVersion === next.update.currentVersion &&
		prev.update.latestVersion === next.update.latestVersion &&
		prev.update.url === next.update.url &&
		prev.update.error === next.update.error
	);
}

export function useAppInfo() {
	return useQueryResource<AppInfo>(fetchAppInfo, FALLBACK_APP_INFO, {
		queryKey: ["app-info"],
		isEqual: areAppInfoEqual,
	});
}
