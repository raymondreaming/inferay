import { useEffect, useMemo, useRef, useState } from "octane";
import type React from "react";
import { hasId } from "../../../../shared/lib/data.ts";
import type { ReactNode } from "../../../../shared/ui/gooey/observer.ts";
import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import { getAgentDefinition } from "../../../agents/model/agents.ts";
import type { WorkspaceModelAgentKind as AgentKind } from "../../../workspace/model/workspace-model.ts";
import type { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import type { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { renderInputHighlights } from "../ChatTokenDecorators/index.tsx";
export type AgentOption = {
	id: AgentKind;
	label: string;
	icon: unknown;
};
export function useChatComposerState(
	props: ReturnType<typeof useAgentChatComposerState> &
		ReturnType<typeof useAgentChatMenus> & {
			agentKind: AgentKind;
			agentKindOptions: AgentOption[];
			model: string;
			reasoningLevel: string;
			onAgentKindChange: (agentKind: AgentKind) => void;
			onModelChange: (model: string) => void;
			onReasoningLevelChange: (reasoningLevel: string) => void;
			onAgentConfigOpenChange?: (open: boolean) => void;
			input: string;
			setInput: (value: string) => void;
			handleKeyDown: (e: KeyboardEvent) => void;
			textareaRef: React.RefObject<HTMLTextAreaElement | null>;
			highlightOverlayRef: React.RefObject<HTMLDivElement | null>;
			onMdFileClick: (path: string) => void;
			voiceInput?: {
				error: string | null;
				isListening: boolean;
				isSupported: boolean;
				onToggleListening: () => void;
			};
			workspaceControl?: ReactNode;
			beamActive?: boolean;
		},
) {
	const {
		agentKind,
		agentKindOptions,
		model,
		reasoningLevel,
		onAgentKindChange,
		onModelChange,
		onReasoningLevelChange,
		onAgentConfigOpenChange,
		input,
		slashCommandNames,
		beamActive = false,
	} = props;
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const agentConfigControlsRef = useRef<HTMLDivElement | null>(null);
	const agentConfigButtonRef = useRef<HTMLButtonElement | null>(null);
	const agentConfigMenuRef = useRef<HTMLDivElement | null>(null);
	const [activeConfig, setActiveConfig] = useState<string | null>(null);
	const agentConfigOpen = activeConfig !== null;
	const [messageInputFocused, setMessageInputFocused] = useState(false);
	useEffect(() => {
		onAgentConfigOpenChange?.(agentConfigOpen);
	}, [agentConfigOpen, onAgentConfigOpenChange]);
	useEffect(
		() => () => onAgentConfigOpenChange?.(false),
		[onAgentConfigOpenChange],
	);
	const usePlainTextarea = input.length > 6000;
	const inputHighlights = useMemo(
		() =>
			usePlainTextarea ? null : renderInputHighlights(input, slashCommandNames),
		[input, slashCommandNames, usePlainTextarea],
	);
	const agentDefinition = getAgentDefinition(agentKind);
	const selectedModel = agentDefinition.models.find(hasId.bind(null, model));
	const selectedModelLabel = selectedModel?.label || model || "No model";
	const selectedReasoningLabel =
		agentDefinition.reasoningLevels.find(hasId.bind(null, reasoningLevel))
			?.label || reasoningLevel;
	const configControls = [
		{
			id: "provider",
			title: "Provider",
			label: agentDefinition.label,
			value: agentKind,
			options: agentKindOptions,
			icon: getAgentIcon(agentKind, 10),
			onChange: (id: string) => onAgentKindChange(id as AgentKind),
		},
		...(agentDefinition.models.length
			? [
					{
						id: "model",
						title: "Model",
						label: selectedModel?.shortLabel || selectedModelLabel,
						value: model,
						options: agentDefinition.models,
						icon: null,
						onChange: onModelChange,
					},
				]
			: []),
		...(agentDefinition.reasoningLevels.length
			? [
					{
						id: "reasoning",
						title: "Reasoning",
						label: selectedReasoningLabel,
						value: reasoningLevel,
						options: agentDefinition.reasoningLevels,
						icon: null,
						onChange: onReasoningLevelChange,
					},
				]
			: []),
	];
	const activeControl = configControls.find(
		(control) => control.id === activeConfig,
	);
	useEffect(() => {
		if (!agentConfigOpen) return;
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
	}, [agentConfigOpen]);
	useEffect(() => {
		if (!activeConfig) return;
		const menu = agentConfigMenuRef.current;
		(
			menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
			menu?.querySelector<HTMLButtonElement>("button")
		)?.focus();
	}, [activeConfig]);
	return {
		...props,
		beamActive,
		fileInputRef,
		agentConfigControlsRef,
		agentConfigButtonRef,
		agentConfigMenuRef,
		activeConfig,
		setActiveConfig,
		messageInputFocused,
		setMessageInputFocused,
		usePlainTextarea,
		inputHighlights,
		selectedModelLabel,
		configControls,
		activeControl,
	};
}
