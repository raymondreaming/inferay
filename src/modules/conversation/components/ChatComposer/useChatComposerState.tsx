import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	type Element,
	merge,
} from "solid-js";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import type { RefCell } from "../../../../shared/lib/dom.tsx";
import { hasId } from "../../../../shared/lib/dom.tsx";
import { getAgentDefinition } from "../../../../shared/lib/native.tsx";
import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import type { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { renderInputHighlights } from "../ChatTokenDecorators/index.tsx";
export type AgentOption = {
	id: WorkspaceAgentKind;
	label: string;
	icon: Element;
};
export function useChatComposerState(
	_props: Accessor<
		ReturnType<typeof useAgentChatComposerState> &
			ReturnType<typeof useAgentChatMenus> & {
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
	const _source = createMemo(() => _props());
	const fileInputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	const agentConfigControlsRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const agentConfigButtonRef = {
		current: null,
	} as {
		current: HTMLButtonElement | null;
	};
	const agentConfigMenuRef = {
		current: null,
	} as {
		current: HTMLDivElement | null;
	};
	const [activeConfig, setActiveConfig] = createSignal<string | null>(null);
	const agentConfigOpen = createMemo(() => activeConfig() !== null);
	const [messageInputFocused, setMessageInputFocused] = createSignal(false);
	createEffect(
		() => [agentConfigOpen(), _source().onAgentConfigOpenChange],
		() => {
			_source().onAgentConfigOpenChange?.(agentConfigOpen());
		},
	);
	createEffect(
		() => [_source().onAgentConfigOpenChange],
		() => () => _source().onAgentConfigOpenChange?.(false),
	);
	const usePlainTextarea = createMemo(() => _source().input.length > 6000);
	const inputHighlights = createMemo(() => {
		const _sourceValue = _source();
		return usePlainTextarea()
			? null
			: renderInputHighlights(
					_sourceValue.input,
					_sourceValue.slashCommandNames,
				);
	});
	const agentDefinition = createMemo(() =>
		getAgentDefinition(_source().agentKind),
	);
	const selectedModel = createMemo(() =>
		agentDefinition().models.find(hasId.bind(null, _source().model)),
	);
	const selectedModelLabel = createMemo(
		() => selectedModel()?.label || _source().model || "No model",
	);
	const selectedReasoningLabel = createMemo(() => {
		const _sourceValue2 = _source();
		return (
			agentDefinition().reasoningLevels.find(
				hasId.bind(null, _sourceValue2.reasoningLevel),
			)?.label || _sourceValue2.reasoningLevel
		);
	});
	const configControls = createMemo(() => {
		const _agentDefinitionValue = agentDefinition(),
			_sourceValue3 = _source();
		return [
			{
				id: "provider",
				title: "Provider",
				label: _agentDefinitionValue.label,
				value: _sourceValue3.agentKind,
				options: _sourceValue3.agentKindOptions,
				icon: getAgentIcon(_sourceValue3.agentKind, 10),
				onChange: (id: string) =>
					_source().onAgentKindChange(id as WorkspaceAgentKind),
			},
			...(_agentDefinitionValue.models.length
				? [
						{
							id: "model",
							title: "Model",
							label: selectedModel()?.shortLabel || selectedModelLabel(),
							value: _sourceValue3.model,
							options: _agentDefinitionValue.models,
							icon: null,
							onChange: _sourceValue3.onModelChange,
						},
					]
				: []),
			...(_agentDefinitionValue.reasoningLevels.length
				? [
						{
							id: "reasoning",
							title: "Reasoning",
							label: selectedReasoningLabel(),
							value: _sourceValue3.reasoningLevel,
							options: _agentDefinitionValue.reasoningLevels,
							icon: null,
							onChange: _sourceValue3.onReasoningLevelChange,
						},
					]
				: []),
		];
	});
	const activeControl = createMemo(() =>
		configControls().find((control) => control.id === activeConfig()),
	);
	createEffect(
		() => [agentConfigOpen()],
		() => {
			if (!agentConfigOpen()) return;
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
		() => [activeConfig()],
		() => {
			if (!activeConfig()) return;
			const menu = agentConfigMenuRef.current;
			(
				menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
				menu?.querySelector<HTMLButtonElement>("button")
			)?.focus();
		},
	);
	return merge(
		() => {
			const _sourceValue4 = _source();
			return _props();
		},
		{
			get beamActive() {
				const _sourceValue4 = _source();
				return _sourceValue4.beamActive === undefined
					? false
					: _sourceValue4.beamActive;
			},
			get fileInputRef() {
				return fileInputRef;
			},
			get agentConfigControlsRef() {
				return agentConfigControlsRef;
			},
			get agentConfigButtonRef() {
				return agentConfigButtonRef;
			},
			get agentConfigMenuRef() {
				return agentConfigMenuRef;
			},
			get activeConfig() {
				return activeConfig();
			},
			get setActiveConfig() {
				return setActiveConfig;
			},
			get messageInputFocused() {
				return messageInputFocused();
			},
			get setMessageInputFocused() {
				return setMessageInputFocused;
			},
			get usePlainTextarea() {
				return usePlainTextarea();
			},
			get inputHighlights() {
				return inputHighlights();
			},
			get selectedModelLabel() {
				return selectedModelLabel();
			},
			get configControls() {
				return configControls();
			},
			get activeControl() {
				return activeControl();
			},
		},
	);
}
