import { useCallback, useEffect, useMemo, useRef, useState } from "octane";

import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import {
	loadDefaultChatSettings,
	resolveChatSettings,
} from "../../../agents/model/agents.ts";
import {
	type AgentKind,
	changePaneAgentKind,
} from "../../../workspace/model/workspace-model.ts";
import {
	loadStoredModel,
	loadStoredReasoningLevel,
	saveStoredModel,
	saveStoredReasoningLevel,
} from "../../model/chat-session-store.ts";

export function useAgentChatSettings(paneId: string, agentKind: AgentKind) {
	const [selection, setSelection] = useState(() => ({
		model: loadStoredModel(paneId) ?? "",
		reasoningLevel: loadStoredReasoningLevel(paneId) ?? "",
	}));
	const pendingSelection = useRef<{
		model: string | null;
		reasoningLevel: string | null;
	}>(selection);
	const [configurationError, setConfigurationError] = useState<string | null>(
		null,
	);
	const requestRevision = useRef(0);
	const resolveSelection = useCallback(
		async (
			kind: AgentKind,
			model: string | null,
			reasoningLevel: string | null,
		) => {
			const revision = ++requestRevision.current;
			pendingSelection.current = { model, reasoningLevel };
			try {
				const resolved = await resolveChatSettings({
					agentKind: kind,
					model,
					reasoningLevel,
					defaults: loadDefaultChatSettings(),
				});
				if (revision !== requestRevision.current) return;
				setSelection(resolved);
				pendingSelection.current = resolved;
				saveStoredModel(paneId, resolved.model);
				saveStoredReasoningLevel(paneId, resolved.reasoningLevel);
				setConfigurationError(null);
			} catch (error) {
				if (revision === requestRevision.current)
					setConfigurationError(
						`Could not update chat settings: ${error instanceof Error ? error.message : String(error)}`,
					);
			}
		},
		[paneId],
	);
	useEffect(() => {
		void resolveSelection(
			agentKind,
			loadStoredModel(paneId),
			loadStoredReasoningLevel(paneId),
		);
		return () => {
			requestRevision.current++;
		};
	}, [agentKind, paneId, resolveSelection]);
	const agentKindOptions = useMemo(
		() => [
			{
				id: "claude" as const,
				label: "Claude",
				icon: getAgentIcon("claude", 11),
			},
			{ id: "codex" as const, label: "Codex", icon: getAgentIcon("codex", 11) },
		],
		[],
	);
	return {
		configurationError,
		agentKindOptions,
		effectiveSelectedModel: selection.model,
		selectedReasoningLevel: selection.reasoningLevel,
		handleAgentKindChange: (kind: AgentKind) => {
			changePaneAgentKind(paneId, kind);
		},
		handleModelChange: (model: string) => {
			void resolveSelection(
				agentKind,
				model,
				pendingSelection.current.reasoningLevel,
			);
		},
		handleReasoningLevelChange: (reasoning: string) => {
			void resolveSelection(
				agentKind,
				pendingSelection.current.model,
				reasoning,
			);
		},
	};
}
