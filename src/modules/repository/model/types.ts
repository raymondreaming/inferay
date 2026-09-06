import { fetchJson, sendJson } from "../../../adapters/backend/http.ts";
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
		load: (refresh = false) => {
			if (refresh) invalidate();
			return queryClient.fetchQuery({
				...options,
				retry: false,
				queryFn: ({ signal }) => request(signal),
			});
		},
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
export const fetchForgeAccounts = accountsResource.load;
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
	full_name: string;
	description: string | null;
	html_url: string;
	language: string | null;
	private: boolean;
}

import { useCallback, useState } from "octane";
export function useGitChangeActions({
	cwd,
	applyOptimistic,
	refetchStatus,
}: {
	cwd?: string;
	/** Apply an instant local mutation for the current cwd's git status. */
	applyOptimistic: (
		cwd: string,
		mutator: (p: GitProjectStatus) => GitProjectStatus,
	) => void;
	/** Force a server-truth refetch (called after a fire-and-forget mutation). */
	refetchStatus: () => undefined | Promise<unknown>;
}) {
	const [commitMessage, setCommitMessage] = useState("");
	const [isCommitting, setIsCommitting] = useState(false);

	// Fire a git mutation in the background and reconcile when it settles.
	// Callers apply optimistic UI updates first so the user sees the result
	// instantly regardless of HTTP latency.
	const gitAction = useCallback(
		(endpoint: string, body: object) => {
			void sendJson(`/api/git/${endpoint}`, body)
				.catch(() => {
					/* swallow; refetch below restores truth */
				})
				.finally(() => {
					void refetchStatus();
				});
		},
		[refetchStatus],
	);
	const stageMutation = useCallback(
		(staged: boolean, file?: string) => {
			if (!cwd) return;
			applyOptimistic(cwd, (p) => {
				let changed = 0;
				const files = p.files.map((entry) => {
					if ((file && entry.path !== file) || entry.staged === staged)
						return entry;
					changed += staged ? 1 : -1;
					return { ...entry, staged };
				});
				return {
					...p,
					files: changed ? files : p.files,
				};
			});
			gitAction(staged ? "stage" : "unstage", { cwd, file: file || undefined });
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
		try {
			const response = await sendJson(
				"/api/git/commit",
				{ cwd, message: commitMessage },
				{ signal: AbortSignal.timeout(35_000) },
			);
			const result = (await response.json()) as { success?: boolean };
			if (result.success) {
				setCommitMessage("");
				void refetchStatus();
			}
		} finally {
			setIsCommitting(false);
		}
	}, [cwd, commitMessage, isCommitting, refetchStatus]);
	return {
		commit,
		commitMessage,
		setCommitMessage,
		isCommitting,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	};
}

import { postJson } from "../../../adapters/backend/http.ts";

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
function matchingForgeAccount(
	accounts: ForgeAccount[],
	email: string,
	name: string,
): ForgeAccount | undefined {
	return accounts.find(
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
}
export async function resolveGitAuthorIdentity(
	email?: string | null,
	name?: string | null,
): Promise<{ login: string; avatarUrl: string | null } | null> {
	const normalized = normalizedIdentity(email);
	const normalizedName = normalizedIdentity(name);
	if (!normalized && !normalizedName) return null;
	const login = normalized.match(
		/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/,
	)?.[1];
	if (login)
		return {
			login,
			avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=64`,
		};
	try {
		return (
			matchingForgeAccount(
				await fetchForgeAccounts(),
				normalized,
				normalizedName,
			) ?? null
		);
	} catch {
		return null;
	}
}
export async function resolveGitAuthorAvatar(
	email?: string | null,
	name?: string | null,
): Promise<string | null> {
	return (await resolveGitAuthorIdentity(email, name))?.avatarUrl ?? null;
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
	mergeConflictContent?: string;
	metadata: {
		stats: HunkDiffStats;
		tokenizationDisabled: boolean;
		maxOldLineChars: number;
		maxNewLineChars: number;
		maxInlineLineChars: number;
		maxConflictLineChars: number;
		splitChangeRanges: Array<[number, number]>;
		inlineChangeRanges: Array<[number, number]>;
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
