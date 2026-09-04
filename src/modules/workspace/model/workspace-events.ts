export const CREATE_AGENT_CHAT_EVENT = "create-agent-chat";
export const FOCUS_AGENT_CHAT_COMPOSER_EVENT =
	"inferay-focus-agent-chat-composer";

export interface FocusAgentChatComposerDetail {
	paneId: string;
}

export function dispatchCreateAgentChat(): void {
	window.dispatchEvent(new CustomEvent(CREATE_AGENT_CHAT_EVENT));
}

export function dispatchFocusAgentChatComposer(paneId: string): void {
	window.dispatchEvent(
		new CustomEvent<FocusAgentChatComposerDetail>(
			FOCUS_AGENT_CHAT_COMPOSER_EVENT,
			{ detail: { paneId } },
		),
	);
}
