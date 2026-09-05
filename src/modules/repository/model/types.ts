import { fetchJsonOr } from "../../../adapters/backend/http.ts";

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
	refresh = false,
): Promise<ForgeAccount[]> {
	if (!refresh && cachedAccounts && isFresh(cachedAccounts.cachedAt)) {
		return cachedAccounts.value;
	}
	const data = await fetchJsonOr<{ accounts?: ForgeAccount[] }>(
		refresh ? "/api/forge/accounts?refresh=1" : "/api/forge/accounts",
		{},
	);
	const accounts = Array.isArray(data.accounts) ? data.accounts : [];
	cachedAccounts = {
		value: accounts,
		cachedAt: Date.now(),
	};
	return accounts;
}
export async function fetchGithubRepos(): Promise<GithubRepo[]> {
	if (cachedRepos && isFresh(cachedRepos.cachedAt)) {
		return cachedRepos.value;
	}
	const data = await fetchJsonOr<{ repos?: GithubRepo[] }>(
		"/api/forge/repos?limit=50",
		{},
	);
	const repos = Array.isArray(data.repos) ? data.repos : [];
	cachedRepos = {
		value: repos,
		cachedAt: Date.now(),
	};
	return repos;
}
export interface ForgeAccount {
	provider: "github";
	host: string;
	login: string;
	name: string | null;
	avatarUrl: string | null;
	email: string | null;
	active: boolean;
}
export interface GithubRepo {
	name: string;
	full_name: string;
	description: string | null;
	html_url: string;
	language: string | null;
	stargazers_count: number;
	updated_at: string;
	private: boolean;
}

import { useCallback, useState } from "octane";
export function useGitChangeActions({
	cwd,
	onRefresh,
	applyOptimistic,
	refetchStatus,
}: {
	cwd?: string;
	onRefresh?: () => void;
	/** Apply an instant local mutation for the current cwd's git status. */
	applyOptimistic?: (
		cwd: string,
		mutator: (p: GitProjectStatus) => GitProjectStatus,
	) => void;
	/** Force a server-truth refetch (called after a fire-and-forget mutation). */
	refetchStatus?: () => undefined | Promise<unknown>;
}) {
	const [commitMessage, setCommitMessage] = useState("");
	const [isCommitting, setIsCommitting] = useState(false);
	const [amendMode, setAmendMode] = useState(false);

	// Fire a git mutation in the background and reconcile when it settles.
	// Callers apply optimistic UI updates first so the user sees the result
	// instantly regardless of HTTP latency.
	const gitAction = useCallback(
		(endpoint: string, body: object) => {
			void fetch(`/api/git/${endpoint}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			})
				.catch(() => {
					/* swallow; refetch below restores truth */
				})
				.finally(() => {
					if (refetchStatus) void refetchStatus();
					onRefresh?.();
				});
		},
		[onRefresh, refetchStatus],
	);
	const stageMutation = useCallback(
		(staged: boolean, file?: string) => {
			if (!cwd) return;
			applyOptimistic?.(cwd, (p) => {
				if (file) {
					// Single-file toggle: O(1) count adjustment when state actually changes.
					const target = p.files.find((f) => f.path === file);
					const changed = !!target && target.staged !== staged;
					return {
						...p,
						files: changed
							? p.files.map((f) =>
									f.path === file
										? {
												...f,
												staged,
											}
										: f,
								)
							: p.files,
						stagedCount: changed
							? p.stagedCount + (staged ? 1 : -1)
							: p.stagedCount,
						unstagedCount: changed
							? p.unstagedCount + (staged ? -1 : 1)
							: p.unstagedCount,
					};
				}
				// Bulk stage/unstage: counts are deterministic from total file count.
				return {
					...p,
					files: p.files.map((f) => ({
						...f,
						staged,
					})),
					stagedCount: staged ? p.files.length : 0,
					unstagedCount: staged ? 0 : p.files.length,
				};
			});
			gitAction(
				staged ? "stage" : "unstage",
				file
					? {
							cwd,
							file,
						}
					: {
							cwd,
						},
			);
		},
		[cwd, gitAction, applyOptimistic],
	);
	const stageFile = useCallback(
		(file: string) => stageMutation(true, file),
		[stageMutation],
	);
	const unstageFile = useCallback(
		(file: string) => stageMutation(false, file),
		[stageMutation],
	);
	const stageAll = useCallback(() => stageMutation(true), [stageMutation]);
	const unstageAll = useCallback(() => stageMutation(false), [stageMutation]);
	const commit = useCallback(async () => {
		if (!cwd || !commitMessage.trim() || isCommitting) return;
		setIsCommitting(true);
		const controller = new AbortController();
		const timeout = setTimeout(controller.abort.bind(controller), 35_000);
		try {
			const response = await fetch("/api/git/commit", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					cwd,
					message: commitMessage,
				}),
				signal: controller.signal,
			});
			const result = (await response.json()) as { success?: boolean };
			if (result.success) {
				setCommitMessage("");
				if (refetchStatus) void refetchStatus();
				onRefresh?.();
			}
		} finally {
			clearTimeout(timeout);
			setIsCommitting(false);
		}
	}, [cwd, commitMessage, isCommitting, onRefresh, refetchStatus]);
	return {
		commit,
		commitMessage,
		setCommitMessage,
		isCommitting,
		amendMode,
		setAmendMode,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	};
}

import { postJson } from "../../../adapters/backend/http.ts";

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
		}>("/api/forge/commit-avatars", {
			cwd,
			hashes: [...new Set(hashes)],
		});
		return response.avatars ?? {};
	} catch {
		return {};
	}
}
export interface GitFileTreeNode {
	name: string;
	path: string;
	children: GitFileTreeNode[];
	fileRange: readonly [number, number];
}
export interface GitFilePresentation {
	pathOrder: string[];
	treeOrder: string[];
	tree: GitFileTreeNode[];
}
export interface GitFileEntry {
	status: string; // M, A, D, ?, R, C, U
	staged: boolean;
	path: string;
	originalPath?: string;
	additions?: number;
	deletions?: number;
}
export interface GitProjectStatus {
	filePresentation?: GitFilePresentation;
	cwd: string;
	name: string;
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	stagedCount: number;
	unstagedCount: number;
	untrackedCount: number;
	files: GitFileEntry[];
}

/** Native repository semantics; pixel geometry remains a browser concern. */
export interface GitGraphNavigation {
	historyOrder?: number;
	containingBranch?: string;
	parent?: string;
	child?: string;
	branchNewer?: string;
	branchOlder?: string;
}
export type GitGraphAncestry = Record<string, Array<[number, number]>>;

// Single line in a diff view
export interface DiffLine {
	number: number | null;
	content: string;
	type: "add" | "remove" | "context" | "spacer" | "hunk";
}

// Full diff result with aligned old/new lines
export interface HunkDiff {
	oldLines: DiffLine[];
	newLines: DiffLine[];
	compactLines?: DiffLine[];
	inlineLines?: DiffLine[];
	conflictLines?: DiffLine[];
	isBinary: boolean;
	isNew: boolean;
	isImage?: boolean;
	imagePath?: string;
	rawPatch?: string;
	mergeConflictContent?: string;
	metadata?: {
		stats: HunkDiffStats;
		tokenizationDisabled: boolean;
		maxOldLineChars: number;
		maxNewLineChars: number;
		maxInlineLineChars?: number;
		maxConflictLineChars?: number;
		splitChangeRanges?: Array<[number, number]>;
		inlineChangeRanges?: Array<[number, number]>;
		splitMinimap?: DiffMinimapSegment[];
		inlineMinimap?: DiffMinimapSegment[];
		conflictMinimap?: DiffMinimapSegment[];
	};
}

// Request parameters for loading a diff
export interface DiffRequest {
	cwd: string;
	repositoryRevision?: string;
	file: string;
	staged: boolean;
	commitHash?: string;
	commitParent?: string;
	comparisonFrom?: string;
	comparisonTo?: string;
	view?: "full" | "review";
}
export interface HunkDiffStats {
	added: number;
	removed: number;
	hunks: number;
	lines: number;
}
export type GitInteractiveRebaseStep = {
	readonly hash: string;
	readonly action: "pick" | "reword" | "squash" | "drop";
	readonly message?: string;
};
export type DiffMinimapSegment = {
	type: "add" | "remove";
	side: "left" | "right" | "full";
	startLine: number;
	endLine: number;
};
