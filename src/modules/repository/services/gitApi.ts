import type {
	FileContent,
	ForgeAccount,
	GitActionResponse,
	GitCommitDetails,
	GitComparisonDetails,
	GithubRepo,
	GitRefOperationPreflight,
	GitStatusResult,
	HunkDiff,
} from "@contracts";
import type { DiffRequest } from "@repository/model/diff.ts";
import type {
	GraphData,
	GraphSemanticPreferences,
} from "@repository/model/gitGraph.ts";
import { fetchJson, postJson, request, sendJson } from "@shared/lib/native.tsx";

export function loadGitStatuses(cwds: readonly string[], signal?: AbortSignal) {
	return postJson<GitStatusResult[]>("/api/git/statuses", { cwds }, { signal });
}

export async function runGitChangeAction(
	cwd: string,
	action: "stage" | "unstage",
	file?: string,
): Promise<void> {
	await sendJson(`/api/git/${action}`, { cwd, file });
}

export async function commitGitChanges(
	cwd: string,
	message: string,
): Promise<boolean> {
	const response = await sendJson(
		"/api/git/commit",
		{ cwd, message },
		{ signal: AbortSignal.timeout(35_000) },
	);
	return ((await response.json()) as { success?: boolean }).success === true;
}

export function checkoutGitBranch(cwd: string, branch: string) {
	return postJson<{ ok: boolean; branch?: string; error?: string }>(
		"/api/git/branches",
		{ cwd, branch },
	);
}

export function runGitOperation(cwd: string, endpoint: string, input: object) {
	return postJson<GitActionResponse>(`/api/git/${endpoint}`, { cwd, ...input });
}

export async function generateCommitMessage(cwd: string) {
	const response = await postJson<{ message?: string }>(
		"/api/git/generate-commit-message",
		{ cwd },
	);
	return response.message ?? null;
}

export function preflightGitRefOperation(
	input: { cwd: string; source: string; target: string },
	signal?: AbortSignal,
) {
	return postJson<GitRefOperationPreflight>(
		"/api/git/ref-operation-preflight",
		input,
		{ signal },
	);
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

export async function resolveGitAuthorIdentity(
	email?: string | null,
	name?: string | null,
): Promise<{ login: string; avatarUrl: string | null } | null> {
	if (!email?.trim() && !name?.trim()) return null;
	try {
		const response = await postJson<{
			identities?: Array<{ login: string; avatarUrl: string | null } | null>;
		}>("/api/forge/commit-avatars", {
			identities: [{ email, name }],
		});
		return response.identities?.[0] ?? null;
	} catch {
		return null;
	}
}

export async function loadForgeAccounts(
	refresh = false,
	signal?: AbortSignal,
): Promise<ForgeAccount[]> {
	const response = await fetchJson<{ accounts?: ForgeAccount[] }>(
		`/api/forge/accounts${refresh ? "?refresh=1" : ""}`,
		{ signal },
	);
	return response.accounts ?? [];
}

export async function loadGithubRepos(
	refresh = false,
	signal?: AbortSignal,
): Promise<GithubRepo[]> {
	const response = await fetchJson<{ repos?: GithubRepo[] }>(
		`/api/forge/repos?limit=50${refresh ? "&refresh=1" : ""}`,
		{ signal },
	);
	return response.repos ?? [];
}

export async function restoreDocumentSession(
	input: {
		workspaceId: string;
		sessionId: string;
		cwd: string;
		initialPath?: string;
	},
	signal?: AbortSignal,
) {
	return postJson<{ files: FileContent[]; activePath: string | null }>(
		"/api/workspace/documents",
		input,
		{ signal },
	);
}

export function loadFileContent(
	cwd: string,
	path: string,
	signal?: AbortSignal,
) {
	return fetchJson<FileContent>(
		`/api/files/content?${new URLSearchParams({ cwd, path })}`,
		{ signal },
	);
}

export async function loadGitDiff(
	input: DiffRequest,
	signal: AbortSignal,
): Promise<HunkDiff> {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(input))
		if (value !== undefined) query.set(key, String(value));
	const response = await request(`/api/git/diff?${query}`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
	});
	if (!response.ok)
		throw new Error(`Diff request failed (HTTP ${response.status})`);
	return (await response.json()) as HunkDiff;
}

export async function loadGitGraph(
	input: {
		cwd: string;
		limit: number;
		query: string;
		preferences: GraphSemanticPreferences;
		etag?: string;
	},
	signal?: AbortSignal,
): Promise<{ data?: GraphData; etag?: string; notModified: boolean }> {
	const { cwd, limit, query, preferences, etag } = input;
	const response = await request(
		`/api/git/graph?${new URLSearchParams({
			cwd,
			limit: String(limit),
			query,
			hiddenRefs: JSON.stringify(preferences.hiddenRefs),
			soloRefs: JSON.stringify(preferences.soloRefs),
			pinnedRefs: JSON.stringify(preferences.pinnedRefs),
		})}`,
		{ signal, headers: etag ? { "If-None-Match": etag } : undefined },
	);
	if (response.status === 304) return { notModified: true };
	if (!response.ok) {
		const error = await response.json().catch(() => null);
		throw new Error(error?.error || "Failed to fetch Git history");
	}
	return {
		data: (await response.json()) as GraphData,
		etag: response.headers.get("etag") ?? undefined,
		notModified: false,
	};
}

export async function loadGitCommitDetails(
	cwd: string | undefined,
	hash: string | undefined,
	parent?: string,
	signal?: AbortSignal,
): Promise<GitCommitDetails | null> {
	if (!cwd || !hash) return null;
	const response = await request(
		`/api/git/commit-details?${new URLSearchParams({ cwd, hash, ...(parent ? { parent } : {}) })}`,
		{ signal },
	);
	if (!response.ok) throw new Error("Failed to fetch commit details");
	return (
		((await response.json()) as { details?: GitCommitDetails }).details ?? null
	);
}

export async function loadGitComparisonDetails(
	cwd: string | undefined,
	fromHash: string | undefined,
	toHash: string | undefined,
	selectionKey?: string,
	signal?: AbortSignal,
): Promise<{
	details: GitComparisonDetails | null;
	plan: import("@contracts").ComparisonPlan | null;
} | null> {
	if (!cwd || (!selectionKey && (!fromHash || !toHash || fromHash === toHash)))
		return null;
	const response = await request(
		`/api/git/comparison-details?${selectionKey ? new URLSearchParams({ cwd }) : new URLSearchParams({ cwd, from: fromHash!, to: toHash! })}`,
		selectionKey
			? {
					signal,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: `{"selection":${selectionKey}}`,
				}
			: { signal },
	);
	if (!response.ok) throw new Error("Failed to compare commits");
	return (await response.json()) as {
		details: GitComparisonDetails | null;
		plan: import("@contracts").ComparisonPlan | null;
	};
}
