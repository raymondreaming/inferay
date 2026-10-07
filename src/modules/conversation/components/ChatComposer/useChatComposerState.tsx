import type { WorkspaceAgentKind } from "@contracts";
import type { RefCell } from "@shared/lib/dom.tsx";
import {
	type Accessor,
	createMemo,
	createSignal,
	type Element,
	merge,
} from "solid-js";
import type { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { useAgentConfiguration } from "./useAgentConfiguration.tsx";

type AgentOption = {
	id: WorkspaceAgentKind;
	label: string;
};
export function useChatComposerState(
	_props: Accessor<
		ReturnType<typeof useAgentChatComposerState> &
			ReturnType<typeof useAgentChatMenus> & {
				active?: boolean;
				agentKind: WorkspaceAgentKind;
				agentKindOptions: AgentOption[];
				model: string;
				reasoningLevel: string;
				onAgentKindChange: (agentKind: WorkspaceAgentKind) => void;
				onModelChange: (model: string) => void;
				onReasoningLevelChange: (reasoningLevel: string) => void;
				onAgentConfigOpenChange?: (open: boolean) => void;
				input: string;
				setInput: (value: string) => void;
				handleKeyDown: (e: KeyboardEvent) => void;
				textareaRef: RefCell<HTMLTextAreaElement | null>;
				highlightOverlayRef: RefCell<HTMLDivElement | null>;
				onMdFileClick: (path: string) => void;
				voiceInput?: {
					error: string | null;
					isListening: boolean;
					isSupported: boolean;
					onToggleListening: () => void;
				};
				workspaceControl?: Element;
				beamActive?: boolean;
			}
	>,
) {
	const fileInputRef: RefCell<HTMLInputElement | null> = {
		current: null,
	};
	const config = useAgentConfiguration(_props);
	const [messageInputFocused, setMessageInputFocused] = createSignal(false);
	const usePlainTextarea = createMemo(() => _props().input.length > 6000);
	return merge(_props, config, {
		get beamActive() {
			return _props().beamActive ?? false;
		},
		fileInputRef,
		get messageInputFocused() {
			return messageInputFocused();
		},
		setMessageInputFocused,
		get usePlainTextarea() {
			return usePlainTextarea();
		},
	});
}
