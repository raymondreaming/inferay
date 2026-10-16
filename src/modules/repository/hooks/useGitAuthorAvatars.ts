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
// Loaded author identities survive rebases and repository switches.
let cachedAvatars: Record<string, CachedAvatar> = {};
const [avatars, setAvatars] = createSignal(cachedAvatars);

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
	setAvatars(cachedAvatars);
}

export function rememberLoadedAuthorAvatar(
	email?: string | null,
	url?: string | null,
) {
	const key = email?.trim().toLowerCase();
	if (!key || !url?.startsWith("https://") || cachedAvatars[key]?.url === url)
		return;
	cachedAvatars[key] = { url, savedAt: Date.now() };
	cachedAvatars = Object.fromEntries(
		Object.entries(cachedAvatars)
			.sort((a, b) => b[1].savedAt - a[1].savedAt)
			.slice(0, MAX_CACHED_AVATARS),
	);
	setAvatars(cachedAvatars);
	writeStoredValue(AVATAR_CACHE_KEY, JSON.stringify(cachedAvatars));
}

export function knownAuthorAvatar(email?: string | null) {
	return avatars()[email?.trim().toLowerCase() ?? ""]?.url;
}

export function useGitAuthorAvatars(
	repository: Accessor<string | undefined>,
	commits: Accessor<readonly AuthorCommit[]>,
) {
	const [resolved, setResolved] = createSignal<Record<string, string>>({});
	let resolving = false;
	let pending = false;
	let lastRequest = "";
	const avatarForCommit = (commit: AuthorCommit) =>
		knownAuthorAvatar(commit.authorEmail) ?? resolved()[commit.hash];
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
			const loaded = await resolveGitCommitAvatars(cwd, missing);
			setResolved((previous) =>
				Object.fromEntries(
					commits().flatMap((commit) => {
						const url =
							loaded[commit.hash] ??
							previous[commit.hash] ??
							knownAuthorAvatar(commit.authorEmail);
						return url ? [[commit.hash, url]] : [];
					}),
				),
			);
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
