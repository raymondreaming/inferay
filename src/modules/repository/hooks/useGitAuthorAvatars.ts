import type { GraphCommit } from "@contracts";
import { resolveGitCommitAvatars } from "@repository/services/gitApi.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";

type AuthorCommit = Pick<GraphCommit, "hash" | "author" | "authorEmail">;

// Author identity survives new commit hashes, rebases, and repository switches.
const [avatars, setAvatars] = createSignal<{
	authors: Record<string, string>;
	commits: Record<string, string>;
}>({ authors: {}, commits: {} });

export function knownAuthorAvatar(email?: string | null) {
	return avatars().authors[email?.trim().toLowerCase() ?? ""];
}

export function useGitAuthorAvatars(
	repository: Accessor<string | undefined>,
	commits: Accessor<readonly AuthorCommit[]>,
) {
	const avatarForCommit = (commit: AuthorCommit) =>
		knownAuthorAvatar(commit.authorEmail) ?? avatars().commits[commit.hash];
	const requestKey = createMemo(() =>
		commits()
			.filter((commit) => !avatarForCommit(commit))
			.map(({ hash }) => hash)
			.join(","),
	);
	createEffect(
		() => [requestKey(), repository()] as const,
		([key, cwd]) => {
			if (!key || !cwd) return;
			const timer = window.setTimeout(() => {
				const missing = commits().filter((commit) => !avatarForCommit(commit));
				if (!missing.length) return;
				void resolveGitCommitAvatars(cwd, missing).then((resolved) => {
					// Keep successful results even if the user scrolled or switched
					// repositories while the request was running.
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
				});
			}, 100);
			return () => window.clearTimeout(timer);
		},
	);
	return avatarForCommit;
}
