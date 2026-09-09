import type { Accessor } from "solid-js";
import type { AgentContextUpdate } from "../../../../build/presentation/contracts/AgentContextUpdate.ts";
import type { EffectiveAgentContext } from "../../../../build/presentation/contracts/EffectiveAgentContext.ts";
import { useBackgroundQuery } from "../../../shared/hooks/useQueryResource.tsx";
import { queryClient } from "../../../shared/lib/dom.tsx";
import { fetchJson, postJson } from "../../../shared/lib/native.tsx";

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
		() => ({
			queryKey: ["agent-context", _paneId(), _cwd()],
			queryFn: async ({ signal }) => {
				const params = new URLSearchParams({ paneId: _paneId() });
				const cwd = _cwd();
				if (cwd) params.set("cwd", cwd);
				return fetchJson<EffectiveAgentContext>(
					`/api/agent-context?${params}`,
					{ signal },
				);
			},
			retry: false,
		}),
		() => queryClient,
	);
	const save = async (
		scope: AgentContextUpdate["scope"],
		instructions: string,
		mode: AgentContextMode,
	) => {
		const paneId = _paneId();
		const cwd = _cwd();
		await postJson(
			"/api/agent-context",
			{
				scope,
				instructions,
				mode,
				cwd,
				paneId,
			},
			{
				method: "PUT",
			},
		);
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
		get save() {
			return save;
		},
	};
}
export type AgentContextMode = "inherit" | "replace";
