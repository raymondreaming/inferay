export const TERMINAL_STATE_STORAGE_KEY = "inferay-terminal-state";
export const TERMINAL_MAIN_VIEW_STORAGE_KEY = "terminal-main-view";
const TERMINAL_LAYOUT_MODE_STORAGE_KEY = "terminal-layout-mode";
const EDITOR_SELECTED_PANE_STORAGE_KEY = "editor-selected-pane";
const MAIN_SIDEBAR_WIDTH_STORAGE_KEY = "main-sidebar-width";
export const ONBOARDING_DONE_STORAGE_KEY = "inferay-onboarding-done";
export const APP_THEME_STORAGE_KEY = "inferay-app-theme-id";
export const APP_CUSTOM_THEME_STORAGE_KEY = "inferay-app-custom-theme";
export const APP_BACKGROUND_STORAGE_KEY = "inferay-app-background";
const CHAT_MESSAGES_STORAGE_KEY_PREFIX = "inferay-chat-";
const CHAT_SESSION_KEY_PREFIX = "inferay-chat-session-";
const CHAT_INPUT_KEY_PREFIX = "inferay-chat-input-";
const CHAT_CHECKPOINT_KEY_PREFIX = "inferay-checkpoints-";
const CHAT_MODEL_KEY_PREFIX = "inferay-chat-model-";
const CHAT_REASONING_KEY_PREFIX = "inferay-chat-reasoning-";
const CHAT_PENDING_SEND_KEY_PREFIX = "inferay-chat-pending-send-";
const CHAT_SUMMARY_KEY_PREFIX = "inferay-chat-summary-";
export const CHAT_SESSION_INDEX_STORAGE_KEY = "inferay-session-library";
const CHAT_PENDING_WORKSPACE_KEY_PREFIX = "inferay-chat-pending-workspace-";
export const CHAT_QUEUE_KEY_PREFIX = "inferay-chat-queue-";
const CHAT_LOADING_STATE_KEY_PREFIX = "inferay-chat-loading-";
const CHAT_COMPOSER_CONTEXT_KEY_PREFIX = "inferay-chat-composer-context-";
const CHAT_WORKTREE_INFO_KEY_PREFIX = "inferay-chat-worktree-";

const CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES = [
	CHAT_SESSION_KEY_PREFIX,
	CHAT_INPUT_KEY_PREFIX,
	CHAT_CHECKPOINT_KEY_PREFIX,
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

export function isChatMessageStorageKey(key: string): boolean {
	return (
		key.startsWith(CHAT_MESSAGES_STORAGE_KEY_PREFIX) &&
		!CHAT_NON_MESSAGE_STORAGE_KEY_PREFIXES.some((prefix) =>
			key.startsWith(prefix)
		)
	);
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
	if (key === TERMINAL_STATE_STORAGE_KEY) return false;
	if (isChatMessageStorageKey(key)) return false;
	if (key.startsWith(CHAT_QUEUE_KEY_PREFIX)) return false;
	if (key.startsWith(CHAT_LOADING_STATE_KEY_PREFIX)) return false;
	return (
		SYNCED_STORAGE_KEYS.has(key) ||
		SYNCED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
	);
}
