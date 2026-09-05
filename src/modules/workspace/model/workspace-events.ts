import {
	readStoredBoolean,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";

export const CREATE_AGENT_CHAT_EVENT = "create-agent-chat";
export const FOCUS_AGENT_CHAT_COMPOSER_EVENT =
	"inferay-focus-agent-chat-composer";

export type CreateAgentChatTarget = "active-repository" | "new-repository";

export interface CreateAgentChatDetail {
	target: CreateAgentChatTarget;
}

export interface FocusAgentChatComposerDetail {
	paneId: string;
}

export function resolveCreateAgentChatCwd(
	target: CreateAgentChatTarget,
	activeRepositoryCwd?: string,
): string | undefined {
	return target === "active-repository" ? activeRepositoryCwd : undefined;
}

export function dispatchCreateAgentChat(
	target: CreateAgentChatTarget = "active-repository",
): void {
	window.dispatchEvent(
		new CustomEvent<CreateAgentChatDetail>(CREATE_AGENT_CHAT_EVENT, {
			detail: { target },
		}),
	);
}

export function dispatchFocusAgentChatComposer(paneId: string): void {
	window.dispatchEvent(
		new CustomEvent<FocusAgentChatComposerDetail>(
			FOCUS_AGENT_CHAT_COMPOSER_EVENT,
			{ detail: { paneId } },
		),
	);
}

export const WORKSPACE_SIDEBAR_COLLAPSED_EVENT =
	"inferay-workspace-sidebar-collapsed";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebar-collapsed";

export interface WorkspaceSidebarCollapsedDetail {
	collapsed: boolean;
}

export function loadSidebarCollapsed(): boolean {
	return readStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY);
}

export function setWorkspaceSidebarCollapsed(collapsed: boolean): void {
	writeStoredValue(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
	window.dispatchEvent(
		new CustomEvent<WorkspaceSidebarCollapsedDetail>(
			WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
			{ detail: { collapsed } },
		),
	);
}
