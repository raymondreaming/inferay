import type { AppInfo } from "@contracts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { FALLBACK_APP_INFO, loadAppInfo } from "@shared/services/appApi.ts";
export function useAppInfo() {
	return useQueryResource<AppInfo>(
		() => loadAppInfo,
		() => FALLBACK_APP_INFO,
		() => ({
			queryKey: ["app-info"],
		}),
	);
}
