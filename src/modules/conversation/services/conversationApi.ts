import type {
	QueuedMessageInfo,
	SlashCommand,
	WorkspaceAgentKind,
} from "@contracts";
import type { DiffHunk, SequentialEdit } from "@conversation/model/editDiff.ts";
import {
	fetchJson,
	fetchJsonOr,
	postJson,
	request,
	sendJson,
} from "@shared/lib/native.tsx";

export type ChatFileSearchResult = {
	name: string;
	path: string;
	isDir: boolean;
};

export type ProviderConfigSelection = {
	model: string;
	reasoningLevel: string;
};

export type UploadedChatImage = {
	name: string;
	path: string;
	previewUrl: string;
};

export function loadMcpIcons(signal?: AbortSignal) {
	return fetchJson<Record<string, string>>("/api/mcp-icons", { signal });
}

export function loadAgentCommands(
	kind: WorkspaceAgentKind,
	signal?: AbortSignal,
) {
	return fetchJson<SlashCommand[]>(`/api/agent/commands?kind=${kind}`, {
		signal,
	});
}

export async function searchChatFiles(
	query: string,
	cwd?: string,
	signal?: AbortSignal,
): Promise<ChatFileSearchResult[]> {
	const params = new URLSearchParams({ q: query, limit: "15" });
	if (cwd) params.set("cwd", cwd);
	const data = await fetchJsonOr<{ results?: ChatFileSearchResult[] }>(
		`/api/files/search?${params}`,
		{},
		{ signal },
	);
	return data.results ?? [];
}

export function resolveProviderConfig(
	input: Partial<ProviderConfigSelection> & {
		paneId: string;
		agentKind: WorkspaceAgentKind;
	},
) {
	return postJson<ProviderConfigSelection>(
		"/api/native/provider-config",
		input,
	);
}

export async function updateChatQueue(
	paneId: string,
	action: "edit" | "remove",
	id: string,
	text?: string,
): Promise<QueuedMessageInfo[]> {
	const response = await sendJson(
		`/api/chat-queues/${encodeURIComponent(paneId)}`,
		{ action, id, text },
		{ method: "PATCH" },
	);
	if (!response.ok)
		throw new Error("Could not update queued message. Please retry.");
	return ((await response.json()) as { queue: QueuedMessageInfo[] }).queue;
}

export function loadMarkdownPreview(path: string, signal?: AbortSignal) {
	return fetchJson<{ content: string }>(
		`/api/files/preview?${new URLSearchParams({ path })}`,
		{ signal },
	);
}

export async function uploadTempChatImage(
	file: File,
): Promise<UploadedChatImage | null> {
	const body = new FormData();
	body.append("file", file);
	const response = await request("/api/upload-temp", { method: "POST", body });
	const data = (await response.json()) as { path?: string };
	return data.path
		? {
				name: file.name,
				path: data.path,
				previewUrl: `/api/file?thumbnail=true&path=${encodeURIComponent(data.path)}`,
			}
		: null;
}

export async function prepareNativeEditDiff(
	input: { before: string; after: string; edits?: SequentialEdit[] },
	signal: AbortSignal,
): Promise<DiffHunk[]> {
	const response = await sendJson("/api/native/diff", input, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
	});
	if (!response.ok) {
		const failure = await response.json().catch(() => null);
		throw new Error(
			failure?.error ?? `Diff request failed (${response.status})`,
		);
	}
	const result = (await response.json()) as { prepared: { hunks: DiffHunk[] } };
	return result.prepared.hunks;
}
