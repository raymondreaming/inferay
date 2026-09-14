import type {
	PreparedEditDiff,
	ProjectFileEntry,
	ProviderSettings,
	QueuedMessageInfo,
	SequentialEdit,
	SlashCommand,
	WorkspaceAgentKind,
} from "@contracts";
import {
	fetchJson,
	fetchJsonOr,
	postJson,
	request,
} from "@shared/lib/native.tsx";

export type ChatFileSearchResult = Pick<
	ProjectFileEntry,
	"name" | "path" | "isDir"
>;

export type ProviderConfigSelection = Pick<
	ProviderSettings,
	"model" | "reasoningLevel"
>;

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
	const result = await postJson<{ queue: QueuedMessageInfo[] }>(
		`/api/chat-queues/${encodeURIComponent(paneId)}`,
		{ action, id, text },
		{ method: "PATCH" },
		{ message: "Could not update queued message. Please retry." },
	);
	return result.queue;
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
): Promise<PreparedEditDiff> {
	const result = await postJson<{
		prepared: PreparedEditDiff;
	}>(
		"/api/native/diff",
		input,
		{ signal },
		{
			server: true,
			message: (status) => `Diff request failed (${status})`,
		},
	);
	return result.prepared;
}
