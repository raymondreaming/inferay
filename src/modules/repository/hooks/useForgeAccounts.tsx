import type { ForgeAccount, GithubRepo } from "@contracts";
import {
	loadForgeAccounts,
	loadGithubRepos,
} from "@repository/services/gitApi.ts";
import { useQueryResource } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import type { Accessor } from "solid-js";

function forgeResource<T>(
	kind: string,
	load: (refresh: boolean, signal?: AbortSignal) => Promise<T[]>,
) {
	const options = {
		queryKey: ["forge", kind],
		staleTime: 120_000,
	};
	const empty: T[] = [];
	let refreshNative = false;
	const request = async (signal?: AbortSignal): Promise<T[]> => {
		const refreshing = refreshNative;
		const data = await load(refreshing, signal);
		if (refreshing) refreshNative = false;
		return data;
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
	loadForgeAccounts,
);
const reposResource = forgeResource<GithubRepo>("repos", loadGithubRepos);
export const invalidateForgeAccountsCache = accountsResource.invalidate;
export const invalidateGithubReposCache = reposResource.invalidate;
export function useForgeAccounts(enabled: Accessor<boolean> = () => true) {
	return useQueryResource(
		() => accountsResource.request,
		() => accountsResource.empty,
		() => ({ ...accountsResource.options, enabled: enabled() }),
	);
}
export function useGithubRepos(_enabled: Accessor<boolean>) {
	return useQueryResource(
		() => reposResource.request,
		() => reposResource.empty,
		() => ({
			...reposResource.options,
			enabled: _enabled(),
		}),
	);
}
