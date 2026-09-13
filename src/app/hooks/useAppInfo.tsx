import { FALLBACK_APP_INFO, loadAppInfo } from "@app/services/appApi.ts";
import type { AppInfo } from "@contracts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
export function useAppInfo() {
	return useQueryResource<AppInfo>(
		() => loadAppInfo,
		() => FALLBACK_APP_INFO,
		() => ({
			queryKey: ["app-info"],
		}),
	);
}
