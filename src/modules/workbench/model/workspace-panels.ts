import type { PanelAction } from "../../../../build/presentation/contracts/PanelAction.ts";
import type { PanelSession } from "../../../../build/presentation/contracts/PanelSession.ts";
import { postJson } from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/data.ts";
import { emptyGitWorkspacePanelSession } from "./workbench-model.ts";

export const emptyPanelSession = emptyGitWorkspacePanelSession();

export function panelQuery(workspaceId: string) {
	return {
		queryKey: ["workspace-panels", workspaceId],
		queryFn: async () =>
			(
				await postJson<{ session: PanelSession }>("/api/workspace/panels", {
					workspaceId,
				})
			).session,
		staleTime: Infinity,
		gcTime: 30 * 60 * 1000,
	};
}

export function createWorkspacePanelModel() {
	return {
		mutationOptions: (workspaceId: string) => ({
			mutationKey: ["workspace-panels", workspaceId],
			scope: { id: `workspace-panels:${workspaceId}` },
			mutationFn: async ({
				workspaceId,
				action,
			}: {
				workspaceId: string;
				action: PanelAction;
			}) => {
				const wireAction = { ...action };
				if (wireAction.type === "detachFile") delete wireAction.initialFile;
				return postJson<{
					session: PanelSession;
					announcement: string | null;
				}>("/api/workspace/panels", { workspaceId, action: wireAction });
			},
			onSuccess: (
				{ session }: { session: PanelSession },
				{ workspaceId, action }: { workspaceId: string; action: PanelAction },
			) => {
				const current = queryClient.getQueryData<PanelSession>(
					panelQuery(workspaceId).queryKey,
				);
				const pending =
					action.type === "detachFile"
						? current?.detachedFilePanels.filter(
								(panel) =>
									!session.detachedFilePanels.some(
										(saved) => saved.id === panel.id,
									),
							)
						: undefined;
				queryClient.setQueryData(panelQuery(workspaceId).queryKey, {
					...session,
					detachedFilePanels: [
						...session.detachedFilePanels.map((panel) => ({
							...panel,
							initialFile: current?.detachedFilePanels.find(
								(candidate) => candidate.id === panel.id,
							)?.initialFile,
						})),
						...(pending ?? []),
					],
				});
			},
		}),
		preview(workspaceId: string, action: PanelAction) {
			if (action.type === "detachFile") {
				const panel = {
					id: action.id,
					cwd: action.cwd,
					path: action.path,
					initialFile: action.initialFile,
				};
				queryClient.setQueryData<PanelSession>(
					panelQuery(workspaceId).queryKey,
					(current) =>
						current
							? {
									...current,
									detachedFilePanels: [...current.detachedFilePanels, panel],
								}
							: current,
				);
			}
		},
	};
}
