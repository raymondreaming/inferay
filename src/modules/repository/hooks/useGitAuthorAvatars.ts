import type { GraphCommit } from "@contracts";
import { resolveGitCommitAvatars } from "@repository/services/gitApi.ts";
import { readStoredJson, writeStoredValue } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";

type AuthorCommit = Pick<GraphCommit, "hash" | "author" | "authorEmail">;
type CachedAvatar = { url: string; savedAt: number };
const AVATAR_CACHE_KEY = "inferay-author-avatars-v1";
const AVATAR_CACHE_AGE_MS = 24 * 60 * 60_000;
const MAX_CACHED_AVATARS = 500;
let cachedAvatars: Record<string, CachedAvatar> = {};

// Author identity survives new commit hashes, rebases, and repository switches.
const [avatars, setAvatars] = createSignal<{
	authors: Record<string, string>;
	commits: Record<string, string>;
}>({ authors: {}, commits: {} });

export function hydrateAuthorAvatars() {
	const now = Date.now();
	const stored = readStoredJson<Record<string, CachedAvatar>>(
		AVATAR_CACHE_KEY,
		{},
	);
	cachedAvatars = Object.fromEntries(
		Object.entries(stored)
			.filter(
				([email, value]) =>
					email.includes("@") &&
					typeof value?.url === "string" &&
					value.url.startsWith("https://") &&
					typeof value.savedAt === "number" &&
					now - value.savedAt < AVATAR_CACHE_AGE_MS,
			)
			.sort((a, b) => b[1].savedAt - a[1].savedAt)
			.slice(0, MAX_CACHED_AVATARS),
	);
	setAvatars({
		authors: Object.fromEntries(
			Object.entries(cachedAvatars).map(([email, value]) => [email, value.url]),
		),
		commits: {},
	});
}

function rememberAvatars(authors: Record<string, string>) {
	const now = Date.now();
	for (const [email, url] of Object.entries(authors))
		cachedAvatars[email] = { url, savedAt: now };
	cachedAvatars = Object.fromEntries(
		Object.entries(cachedAvatars)
			.sort((a, b) => b[1].savedAt - a[1].savedAt)
			.slice(0, MAX_CACHED_AVATARS),
	);
	writeStoredValue(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
}

export function rememberLoadedAuthorAvatar(
	email?: string | null,
	url?: string | null,
) {
	const key = email?.trim().toLowerCase();
	if (!key || !url?.startsWith("https://") || cachedAvatars[key]?.url === url)
		return;
	setAvatars((previous) =>
		previous.authors[key] === url
			? previous
			: { ...previous, authors: { ...previous.authors, [key]: url } },
	);
	rememberAvatars({ [key]: url });
}

export function knownAuthorAvatar(email?: string | null) {
	return avatars().authors[email?.trim().toLowerCase() ?? ""];
}

export function useGitAuthorAvatars(
	repository: Accessor<string | undefined>,
	commits: Accessor<readonly AuthorCommit[]>,
) {
	let resolving = false;
	let pending = false;
	let lastRequest = "";
	const avatarForCommit = (commit: AuthorCommit) =>
		knownAuthorAvatar(commit.authorEmail) ?? avatars().commits[commit.hash];
	const requestKey = createMemo(() =>
		commits()
			.filter((commit) => !avatarForCommit(commit))
			.map(({ hash }) => hash)
			.join(","),
	);
	const resolveVisible = async (key: string, cwd: string) => {
		const identity = `${cwd}\0${key}`;
		if (identity === lastRequest) return;
		if (resolving) {
			pending = true;
			return;
		}
		const missing = commits().filter((commit) => !avatarForCommit(commit));
		if (!missing.length) return;
		lastRequest = identity;
		resolving = true;
		try {
			const resolved = await resolveGitCommitAvatars(cwd, missing);
			if (Object.values(resolved).some(Boolean)) {
				// Keep successful results across scrolling and repository switches.
				setAvatars((previous) => {
					const authors = { ...previous.authors };
					const hashes = { ...previous.commits };
					for (const commit of missing) {
						const url = resolved[commit.hash];
						if (!url) continue;
						hashes[commit.hash] = url;
						const email = commit.authorEmail.trim().toLowerCase();
						if (email) authors[email] = url;
					}
					return { authors, commits: hashes };
				});
			}
		} finally {
			resolving = false;
			if (pending) {
				pending = false;
				const nextKey = requestKey();
				const nextCwd = repository();
				if (nextKey && nextCwd) void resolveVisible(nextKey, nextCwd);
			}
		}
	};
	createEffect(
		() => [requestKey(), repository()] as const,
		([key, cwd]) => {
			if (!key || !cwd) return;
			void resolveVisible(key, cwd);
		},
	);
	return avatarForCommit;
}
