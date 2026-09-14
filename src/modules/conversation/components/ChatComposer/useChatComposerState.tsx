import type { ComposerConfigControl, WorkspaceAgentKind } from "@contracts";
import type { RefCell } from "@shared/lib/dom.tsx";
import { getAgentDefinition, project } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	type Element,
	merge,
} from "solid-js";
import type { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
export type AgentOption = {
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
	const agentConfigControlsRef: RefCell<HTMLDivElement | null> = {
		current: null,
	};
	const agentConfigButtonRef: RefCell<HTMLButtonElement | null> = {
		current: null,
	};
	const agentConfigMenuRef: RefCell<HTMLDivElement | null> = {
		current: null,
	};
	const [activeConfig, setActiveConfig] = createSignal<string | null>(null);
	const agentConfigOpen = createMemo(() => activeConfig() !== null);
	const [messageInputFocused, setMessageInputFocused] = createSignal(false);
	createEffect(
		() => [agentConfigOpen(), _props().onAgentConfigOpenChange] as const,
		([open, notify]) => {
			notify?.(open);
		},
	);
	createEffect(
		() => _props().onAgentConfigOpenChange,
		(notify) => () => notify?.(false),
	);
	const usePlainTextarea = createMemo(() => _props().input.length > 6000);
	const configControls = createMemo(() => {
		const props = _props();
		const { label, models, reasoningLevels } = getAgentDefinition(
			props.agentKind,
		);
		const changes = {
			provider: (id: string) =>
				_props().onAgentKindChange(id as WorkspaceAgentKind),
			model: props.onModelChange,
			reasoning: props.onReasoningLevelChange,
		};
		return project<ComposerConfigControl[]>("composerConfig", {
			definition: { label, models, reasoningLevels },
			agentKind: props.agentKind,
			agentKindOptions: props.agentKindOptions,
			model: props.model,
			reasoningLevel: props.reasoningLevel,
		}).map((control) => ({ ...control, onChange: changes[control.id] }));
	});
	const activeControl = createMemo(() =>
		configControls().find((control) => control.id === activeConfig()),
	);
	createEffect(
		() => agentConfigOpen(),
		(open) => {
			if (!open) return;
			const handlePointerDown = (event: MouseEvent) => {
				const target = event.target as Node;
				if (
					agentConfigMenuRef.current?.contains(target) ||
					agentConfigControlsRef.current?.contains(target)
				)
					return;
				setActiveConfig(null);
			};
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === "Escape") {
					setActiveConfig(null);
					agentConfigButtonRef.current?.focus();
				}
			};
			document.addEventListener("mousedown", handlePointerDown);
			document.addEventListener("keydown", handleKeyDown);
			return () => {
				document.removeEventListener("mousedown", handlePointerDown);
				document.removeEventListener("keydown", handleKeyDown);
			};
		},
	);
	createEffect(
		() => activeConfig(),
		(active) => {
			if (!active) return;
			const menu = agentConfigMenuRef.current;
			(
				menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
				menu?.querySelector<HTMLButtonElement>("button")
			)?.focus();
		},
	);
	return merge(_props, {
		get beamActive() {
			return _props().beamActive ?? false;
		},
		fileInputRef,
		agentConfigControlsRef,
		agentConfigButtonRef,
		agentConfigMenuRef,
		get activeConfig() {
			return activeConfig();
		},
		setActiveConfig,
		get messageInputFocused() {
			return messageInputFocused();
		},
		setMessageInputFocused,
		get usePlainTextarea() {
			return usePlainTextarea();
		},
		get configControls() {
			return configControls();
		},
		get activeControl() {
			return activeControl();
		},
	});
}
