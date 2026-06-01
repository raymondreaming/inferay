import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";
import {
	clearStoredSessionId,
	loadStoredModel,
	loadStoredReasoningLevel,
	saveStoredModel,
	saveStoredReasoningLevel,
	upsertSessionLibraryEntry,
} from "../../features/chat/chat-session-store.ts";
import {
	type AgentKind,
	changePaneAgentKind,
} from "../../features/terminal/terminal-utils.ts";
import { hasId } from "../../lib/data.ts";

export function useAgentChatModelSettings({
	paneId,
	paneAgentKind,
}: {
	paneId: string;
	paneAgentKind: AgentKind;
}) {
	const [activeAgentKind, setActiveAgentKind] =
		useState<AgentKind>(paneAgentKind);
	const activeAgentKindRef = useRef(activeAgentKind);
	const activePaneIdRef = useRef(paneId);
	useEffect(() => {
		if (
			activePaneIdRef.current === paneId &&
			activeAgentKindRef.current === paneAgentKind
		) {
			return;
		}
		activePaneIdRef.current = paneId;
		setActiveAgentKind(paneAgentKind);
		activeAgentKindRef.current = paneAgentKind;
	}, [paneAgentKind, paneId]);
	useEffect(() => {
		activeAgentKindRef.current = activeAgentKind;
	}, [activeAgentKind]);

	const getDefaultModel = useCallback((kind: AgentKind) => {
		const definition = getAgentDefinition(kind);
		const defaults = loadDefaultChatSettings();
		return kind === defaults.agentKind &&
			definition.models.some(hasId.bind(null, defaults.model))
			? defaults.model
			: definition.defaultModel;
	}, []);

	const [selectedModel, setSelectedModel] = useState(() => {
		const stored = loadStoredModel(paneId);
		const definition = getAgentDefinition(activeAgentKind);
		const defaults = loadDefaultChatSettings();
		return definition.models.some(hasId.bind(null, stored))
			? stored!
			: activeAgentKind === defaults.agentKind &&
				  definition.models.some(hasId.bind(null, defaults.model))
				? defaults.model
				: definition.defaultModel;
	});
	const selectedModelRef = useRef(selectedModel);
	useEffect(() => {
		selectedModelRef.current = selectedModel;
	}, [selectedModel]);

	const agentDefinition = useMemo(
		() => getAgentDefinition(activeAgentKind),
		[activeAgentKind]
	);
	const effectiveSelectedModel = agentDefinition.models.some(
		hasId.bind(null, selectedModel)
	)
		? selectedModel
		: getDefaultModel(activeAgentKind);

	const [selectedReasoningLevel, setSelectedReasoningLevel] = useState(() => {
		const stored = loadStoredReasoningLevel(paneId);
		const defaults = loadDefaultChatSettings();
		return CODEX_REASONING_LEVELS.some(hasId.bind(null, stored))
			? stored!
			: defaults.reasoningLevel;
	});
	const selectedReasoningLevelRef = useRef(selectedReasoningLevel);
	useEffect(() => {
		selectedReasoningLevelRef.current = selectedReasoningLevel;
	}, [selectedReasoningLevel]);

	const handleAgentKindChange = useCallback(
		(nextAgentKind: AgentKind) => {
			setActiveAgentKind(nextAgentKind);
			activeAgentKindRef.current = nextAgentKind;
			changePaneAgentKind(paneId, nextAgentKind);
			clearStoredSessionId(paneId);
			const nextModel = getDefaultModel(nextAgentKind);
			if (nextModel) {
				selectedModelRef.current = nextModel;
				setSelectedModel(nextModel);
				saveStoredModel(paneId, nextModel);
			}
			upsertSessionLibraryEntry(paneId, {
				agentKind: nextAgentKind,
				model: nextModel,
				reasoningLevel:
					nextAgentKind === "codex" ? selectedReasoningLevelRef.current : null,
			});
		},
		[getDefaultModel, paneId]
	);

	const handleModelChange = useCallback(
		(model: string) => {
			selectedModelRef.current = model;
			setSelectedModel(model);
			saveStoredModel(paneId, model);
			clearStoredSessionId(paneId);
		},
		[paneId]
	);

	const handleReasoningLevelChange = useCallback(
		(reasoningLevel: string) => {
			selectedReasoningLevelRef.current = reasoningLevel;
			setSelectedReasoningLevel(reasoningLevel);
			saveStoredReasoningLevel(paneId, reasoningLevel);
			clearStoredSessionId(paneId);
		},
		[paneId]
	);

	return {
		agentKind: activeAgentKind,
		activeAgentKindRef,
		agentDefinition,
		effectiveSelectedModel,
		selectedModelRef,
		selectedReasoningLevel,
		selectedReasoningLevelRef,
		getDefaultModel,
		handleAgentKindChange,
		handleModelChange,
		handleReasoningLevelChange,
		setSelectedModel,
		setSelectedReasoningLevel,
	};
}
