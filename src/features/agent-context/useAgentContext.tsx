import { useCallback, useEffect, useState } from "octane";
import { fetchJson, postJson } from "../../lib/fetch-json.ts";
import type {
	AgentContextMode,
	AgentContextUpdate,
	EffectiveAgentContext,
} from "./types.ts";

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
		scope: "global",
		skillCount: 0,
		skillManifest: "",
		activatedSkills: [],
	});
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState("");

	const reload = useCallback(async () => {
		setIsLoading(true);
		try {
			const params = new URLSearchParams({ paneId });
			if (cwd) params.set("cwd", cwd);
			setContext(await fetchJson(`/api/agent-context?${params.toString()}`));
			setError("");
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : "Unable to load context";
			setError(
				message.includes("404")
					? "Restart Inferay to enable agent context."
					: message
			);
		} finally {
			setIsLoading(false);
		}
	}, [cwd, paneId]);

	useEffect(() => void reload(), [reload]);

	const save = useCallback(
		async (
			scope: AgentContextUpdate["scope"],
			instructions: string,
			mode: AgentContextMode
		) => {
			await postJson(
				"/api/agent-context",
				{ scope, instructions, mode, cwd, paneId },
				{ method: "PUT" }
			);
			await reload();
		},
		[cwd, paneId, reload]
	);

	return { context, error, isLoading, reload, save };
}
