import { postJson } from "../../../adapters/backend/http.ts";
import { queryClient } from "../../../shared/lib/data.ts";
import {
	emptyGitWorkspacePanelSession,
	type FileContentResponse,
	type GitWorkspaceDetachedFilePanel,
	type GitWorkspacePanelAction,
	type GitWorkspacePanelSession,
} from "./workbench-model.ts";

type DetachedFilePanel = GitWorkspaceDetachedFilePanel<FileContentResponse>;

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

/** Preserves local file previews while serial native mutations acknowledge panel identity. */
export function createWorkspacePanelModel() {
	const draggedFiles = new Map<
		string,
		{ panel: DetachedFilePanel; pending: boolean; workspaceId: string }
	>();
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
				await queryClient.ensureQueryData(panelQuery(workspaceId));
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
				const file =
					"id" in action && action.id ? draggedFiles.get(action.id) : undefined;
				if (file && action.type === "detachFile") file.pending = false;
				if (action.type === "closeFile") draggedFiles.delete(action.id);
				const panels = session.detachedFilePanels.map((panel) => ({
					...panel,
					initialFile: draggedFiles.get(panel.id)?.panel.initialFile,
				}));
				for (const entry of draggedFiles.values()) {
					if (
						entry.workspaceId === workspaceId &&
						entry.pending &&
						!panels.some((panel) => panel.id === entry.panel.id)
					)
						panels.push({
							...entry.panel,
							initialFile: entry.panel.initialFile,
						});
				}
				queryClient.setQueryData(panelQuery(workspaceId).queryKey, {
					...session,
					detachedFilePanels: panels,
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
				draggedFiles.set(action.id, {
					panel,
					pending: true,
					workspaceId,
				});
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
