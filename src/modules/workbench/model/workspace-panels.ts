import { postJson } from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/data.ts";
import {
	emptyGitWorkspacePanelSession,
	type FileContentResponse,
	type GitWorkspacePanelAction,
	type GitWorkspacePanelSession,
} from "./workbench-model.ts";

type WorkspacePanelSession = GitWorkspacePanelSession<FileContentResponse>;

export const emptyPanelSession =
	emptyGitWorkspacePanelSession<FileContentResponse>();
export type PanelAction = GitWorkspacePanelAction<FileContentResponse>;
export function panelQuery(workspaceId: string) {
	return {
		queryKey: ["workspace-panels", workspaceId],
		queryFn: async () =>
			(
				await postJson<{ session: WorkspacePanelSession }>(
					"/api/workspace/panels",
					{ workspaceId },
				)
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
					session: WorkspacePanelSession;
					announcement: string | null;
				}>("/api/workspace/panels", { workspaceId, action: wireAction });
			},
			onSuccess: (
				{ session }: { session: WorkspacePanelSession },
				{ workspaceId, action }: { workspaceId: string; action: PanelAction },
			) => {
				const current = queryClient.getQueryData<WorkspacePanelSession>(
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
				queryClient.setQueryData<WorkspacePanelSession>(
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
