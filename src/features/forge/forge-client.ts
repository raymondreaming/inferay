import { fetchJsonOr } from "../../lib/fetch-json.ts";
import type { ForgeAccount, GithubRepo } from "./types.ts";

const CACHE_TTL_MS = 120_000;

let cachedAccounts: { value: ForgeAccount[]; cachedAt: number } | null = null;
let cachedRepos: { value: GithubRepo[]; cachedAt: number } | null = null;

function isFresh(cachedAt: number) {
	return Date.now() - cachedAt < CACHE_TTL_MS;
}

export function getCachedForgeAccounts(): ForgeAccount[] {
	return cachedAccounts && isFresh(cachedAccounts.cachedAt)
		? cachedAccounts.value
		: [];
}

export function getCachedGithubRepos(): GithubRepo[] {
	return cachedRepos && isFresh(cachedRepos.cachedAt) ? cachedRepos.value : [];
}

export function invalidateForgeAccountsCache(): void {
	cachedAccounts = null;
}

export function invalidateGithubReposCache(): void {
	cachedRepos = null;
}

export async function fetchForgeAccounts(
	refresh = false
): Promise<ForgeAccount[]> {
	if (!refresh && cachedAccounts && isFresh(cachedAccounts.cachedAt)) {
		return cachedAccounts.value;
	}
	const data = await fetchJsonOr<{ accounts?: ForgeAccount[] }>(
		refresh ? "/api/forge/accounts?refresh=1" : "/api/forge/accounts",
		{}
	);
	const accounts = Array.isArray(data.accounts) ? data.accounts : [];
	cachedAccounts = { value: accounts, cachedAt: Date.now() };
	return accounts;
}

export async function fetchGithubRepos(): Promise<GithubRepo[]> {
	if (cachedRepos && isFresh(cachedRepos.cachedAt)) {
		return cachedRepos.value;
	}
	const data = await fetchJsonOr<{ repos?: GithubRepo[] }>(
		"/api/forge/repos?limit=50",
		{}
	);
	const repos = Array.isArray(data.repos) ? data.repos : [];
	cachedRepos = { value: repos, cachedAt: Date.now() };
	return repos;
}
