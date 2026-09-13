import {
	loadAgentContext,
	saveAgentContext,
} from "@context/services/contextApi.ts";
import type { AgentContextUpdate, EffectiveAgentContext } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import type { Accessor } from "solid-js";

const EMPTY = {
	instructions: "",
	mode: "inherit" as const,
	updatedAt: 0,
};
export function useAgentContext(
	_paneId: Accessor<string>,
	_cwd: Accessor<string | undefined> = () => undefined,
) {
	const empty: EffectiveAgentContext = {
		global: EMPTY,
		project: null,
		chat: null,
		effectiveInstructions: "",
	};
	const query = useBackgroundQuery(
		() => {
			const paneId = _paneId(),
				cwd = _cwd();
			return {
				queryKey: ["agent-context", paneId, cwd],
				queryFn: ({ signal }) => loadAgentContext(paneId, cwd, signal),
				retry: false,
			};
		},
		() => queryClient,
	);
	const save = async (
		scope: AgentContextUpdate["scope"],
		instructions: string,
		mode: AgentContextMode,
	) => {
		const paneId = _paneId();
		const cwd = _cwd();
		await saveAgentContext({ scope, instructions, mode, cwd, paneId });
		await queryClient.invalidateQueries({ queryKey: ["agent-context"] });
	};
	return {
		get error() {
			return query.error instanceof Error ? query.error.message : null;
		},
		get isLoading() {
			return query.data === undefined;
		},
		get context() {
			return query.data ?? empty;
		},
		save,
	};
}
export type AgentContextMode = "inherit" | "replace";
