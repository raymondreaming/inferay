import type { ForgeAccount } from "../../../../build/presentation/contracts/ForgeAccount.ts";
import type { GithubRepo } from "../../../../build/presentation/contracts/GithubRepo.ts";
import { fetchJson } from "../../../adapters/backend/http.ts";
import { useQueryResource } from "../../../shared/hooks/useQueryResource.tsx";
import { queryClient } from "../../../shared/lib/data.ts";

function forgeResource<T>(kind: string, field: string, url: string) {
	const options = { queryKey: ["forge", kind], staleTime: 120_000 };
	const empty: T[] = [];
	let refreshNative = false;
	const request = async (signal?: AbortSignal): Promise<T[]> => {
		const refreshing = refreshNative;
		const data = await fetchJson<Record<string, T[]>>(
			refreshing ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url,
			{ signal },
		);
		if (refreshing) refreshNative = false;
		return Array.isArray(data[field]) ? data[field]! : empty;
	};
	const invalidate = () => {
		refreshNative = true;
		void queryClient.invalidateQueries({
			queryKey: options.queryKey,
			refetchType: "none",
		});
	};
	return {
		request,
		options,
		empty,
		invalidate,
	};
}
const accountsResource = forgeResource<ForgeAccount>(
	"accounts",
	"accounts",
	"/api/forge/accounts",
);
const reposResource = forgeResource<GithubRepo>(
	"repos",
	"repos",
	"/api/forge/repos?limit=50",
);
export const invalidateForgeAccountsCache = accountsResource.invalidate;
export const invalidateGithubReposCache = reposResource.invalidate;
export function fetchForgeAccounts() {
	accountsResource.invalidate();
	return queryClient.fetchQuery({
		...accountsResource.options,
		retry: false,
		queryFn: ({ signal }) => accountsResource.request(signal),
	});
}
export function useForgeAccounts() {
	return useQueryResource(
		accountsResource.request,
		accountsResource.empty,
		accountsResource.options,
	);
}
export function useGithubRepos(enabled: boolean) {
	return useQueryResource(reposResource.request, reposResource.empty, {
		...reposResource.options,
		enabled,
	});
}
