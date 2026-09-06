import { useCallback, useEffect, useState } from "octane";
import { fetchJson, postJson } from "../../../adapters/backend/http.ts";
import type {
	AgentContextMode,
	AgentContextUpdate,
	EffectiveAgentContext,
} from "../../skills/model/skill-library.ts";

const EMPTY = {
	instructions: "",
	mode: "inherit" as const,
	updatedAt: 0,
};

export function useAgentContext(paneId: string, cwd?: string) {
	const [context, setContext] = useState<EffectiveAgentContext>({
		global: EMPTY,
		project: null,
		chat: null,
		effectiveInstructions: "",
	});

	const reload = useCallback(async () => {
		try {
			const params = new URLSearchParams({ paneId });
			if (cwd) params.set("cwd", cwd);
			setContext(await fetchJson(`/api/agent-context?${params.toString()}`));
		} catch {}
	}, [cwd, paneId]);

	useEffect(() => void reload(), [reload]);

	const save = useCallback(
		async (
			scope: AgentContextUpdate["scope"],
			instructions: string,
			mode: AgentContextMode,
		) => {
			await postJson(
				"/api/agent-context",
				{ scope, instructions, mode, cwd, paneId },
				{ method: "PUT" },
			);
			await reload();
		},
		[cwd, paneId, reload],
	);

	return { context, save };
}
