import { postJson } from "../../adapters/backend/http.ts";
import {
	fetchForgeAccounts,
	getCachedForgeAccounts,
} from "../../modules/repository/forge/forge-client.ts";

const avatarUrlCache = new Map<string, Promise<string | null>>();
let forgeAccountsRequest: ReturnType<typeof fetchForgeAccounts> | null = null;

function normalizedIdentity(value?: string | null): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function compactIdentity(value: string): string {
	return value.replace(/[^a-z0-9]/g, "");
}

function identityLooksRelated(
	email: string,
	name: string,
	accountName: string,
	login: string,
): boolean {
	const emailHandle = compactIdentity(email.split("@", 1)[0] ?? "");
	const authorName = compactIdentity(name);
	const githubName = compactIdentity(accountName);
	const githubLogin = compactIdentity(login);
	const prefixMatch = (left: string, right: string) =>
		Math.min(left.length, right.length) >= 3 &&
		(left.startsWith(right) || right.startsWith(left));
	return (
		prefixMatch(emailHandle, githubLogin) ||
		prefixMatch(authorName, githubLogin) ||
		prefixMatch(authorName, githubName)
	);
}

function matchingForgeAvatar(email: string, name: string): string | null {
	const account = getCachedForgeAccounts().find(
		(candidate) =>
			(email && normalizedIdentity(candidate.email) === email) ||
			(name &&
				(normalizedIdentity(candidate.name) === name ||
					normalizedIdentity(candidate.login) === name.replace(/\s+/g, ""))) ||
			(candidate.active &&
				identityLooksRelated(
					email,
					name,
					normalizedIdentity(candidate.name),
					normalizedIdentity(candidate.login),
				)),
	);
	return account?.avatarUrl ?? null;
}

function resolveForgeAvatar(
	email: string,
	name: string,
): Promise<string | null> {
	const cached = matchingForgeAvatar(email, name);
	if (cached) return Promise.resolve(cached);
	forgeAccountsRequest ??= fetchForgeAccounts().catch(() => []);
	return forgeAccountsRequest.then(() => matchingForgeAvatar(email, name));
}

/** Resolve an author email without allowing incomplete Git metadata to break rendering. */
export function resolveGitAuthorAvatar(
	email?: string | null,
	name?: string | null,
): Promise<string | null> {
	const normalized = normalizedIdentity(email);
	const normalizedName = normalizedIdentity(name);
	if (!normalized && !normalizedName) return Promise.resolve(null);
	const cacheKey = `${normalized}\n${normalizedName}`;
	const cached = avatarUrlCache.get(cacheKey);
	if (cached) return cached;
	const githubIdentity = normalized.match(
		/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/,
	)?.[1];
	if (githubIdentity) {
		const request = Promise.resolve(
			`https://github.com/${encodeURIComponent(githubIdentity)}.png?size=64`,
		);
		avatarUrlCache.set(cacheKey, request);
		return request;
	}
	const request = resolveForgeAvatar(normalized, normalizedName).then(
		(avatar) => avatar,
	);
	avatarUrlCache.set(cacheKey, request);
	return request;
}

export async function resolveGitCommitAvatars(
	cwd: string,
	hashes: readonly string[],
): Promise<Record<string, string | null>> {
	if (!cwd || hashes.length === 0) return {};
	try {
		const response = await postJson<{
			avatars?: Record<string, string | null>;
		}>("/api/forge/commit-avatars", { cwd, hashes: [...new Set(hashes)] });
		return response.avatars ?? {};
	} catch {
		return {};
	}
}
