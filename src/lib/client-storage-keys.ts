export const TERMINAL_STATE_STORAGE_KEY = "inferay-terminal-state";
export const TERMINAL_LAYOUT_MODE_STORAGE_KEY = "terminal-layout-mode";
export const TERMINAL_MAIN_VIEW_STORAGE_KEY = "terminal-main-view";
export const EDITOR_SELECTED_PANE_STORAGE_KEY = "editor-selected-pane";
export const MAIN_SIDEBAR_WIDTH_STORAGE_KEY = "main-sidebar-width";
export const ONBOARDING_DONE_STORAGE_KEY = "inferay-onboarding-done";
export const APP_THEME_STORAGE_KEY = "inferay-app-theme-id";
export const APP_CUSTOM_THEME_STORAGE_KEY = "inferay-app-custom-theme";
export const CHAT_MESSAGES_STORAGE_KEY_PREFIX = "inferay-chat-";
export const CHAT_SESSION_KEY_PREFIX = "inferay-chat-session-";
export const CHAT_INPUT_KEY_PREFIX = "inferay-chat-input-";
export const CHAT_CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
export const CHAT_MODEL_KEY_PREFIX = "inferay-chat-model-";
export const CHAT_REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
export const CHAT_PENDING_SEND_KEY_PREFIX = "inferay-chat-pending-send-";
export const CHAT_SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
export const CHAT_SESSION_INDEX_STORAGE_KEY = "inferay-session-library";
export const CHAT_PENDING_WORKSPACE_KEY_PREFIX =
	"inferay-chat-pending-workspace-";
export const CHAT_QUEUE_KEY_PREFIX = "inferay-chat-queue-";
export const CHAT_LOADING_STATE_KEY_PREFIX = "inferay-chat-loading-";
export const CHAT_COMPOSER_CONTEXT_KEY_PREFIX =
	"inferay-chat-composer-context-";
export const CHAT_WORKTREE_INFO_KEY_PREFIX = "inferay-chat-worktree-";

export const CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES = [
	CHAT_SESSION_KEY_PREFIX,
	CHAT_INPUT_KEY_PREFIX,
	CHAT_MODEL_KEY_PREFIX,
	CHAT_REASONING_KEY_PREFIX,
	CHAT_PENDING_SEND_KEY_PREFIX,
	CHAT_SUMMARY_KEY_PREFIX,
	CHAT_PENDING_WORKSPACE_KEY_PREFIX,
	CHAT_QUEUE_KEY_PREFIX,
	CHAT_LOADING_STATE_KEY_PREFIX,
	CHAT_COMPOSER_CONTEXT_KEY_PREFIX,
	CHAT_WORKTREE_INFO_KEY_PREFIX,
] as const;

export function isChatMessagesStorageKey(key: string): boolean {
	return (
		key.startsWith(CHAT_MESSAGES_STORAGE_KEY_PREFIX) &&
		!CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES.some((prefix) =>
			key.startsWith(prefix)
		)
	);
}

export function isChatQueueStorageKey(key: string): boolean {
	return key.startsWith(CHAT_QUEUE_KEY_PREFIX);
}

const SYNCED_STORAGE_KEYS = new Set([
	TERMINAL_STATE_STORAGE_KEY,
	"commit-graph-columns-v5",
	EDITOR_SELECTED_PANE_STORAGE_KEY,
	"git-watched-dirs",
	MAIN_SIDEBAR_WIDTH_STORAGE_KEY,
	"sidebar-collapsed",
	"terminal-editor-zen",
	TERMINAL_LAYOUT_MODE_STORAGE_KEY,
	TERMINAL_MAIN_VIEW_STORAGE_KEY,
]);

const SYNCED_STORAGE_PREFIXES = [
	"git-change-checkpoint:",
	"inferay-",
	"inferay.",
];

export function shouldSyncClientStorageKey(key: string): boolean {
	if (key.startsWith(CHAT_LOADING_STATE_KEY_PREFIX)) return false;
	return (
		SYNCED_STORAGE_KEYS.has(key) ||
		SYNCED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
	);
}
