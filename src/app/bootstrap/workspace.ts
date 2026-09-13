import { project } from "@shared/lib/native.tsx";
import { traceUi } from "@shared/lib/uiPerformance.ts";
import { configureWorkspacePanels } from "@workspace/hooks/useWorkspacePanelSession.tsx";
import { configureWorkspaceState } from "@workspace/hooks/useWorkspaceState.tsx";
import {
	initializeWorkspaceState,
	loadWorkspaceState,
	saveWorkspaceAction,
	saveWorkspacePanel,
} from "@workspace/services/workspaceApi.ts";

/** Choose the native persistence and projection implementations before rendering. */
export function configureNativeWorkspace() {
	configureWorkspacePanels(saveWorkspacePanel, (session, action, now) =>
		project("panelPreview", { session, action, now }),
	);
	configureWorkspaceState(
		{
			initialize: initializeWorkspaceState,
			load: loadWorkspaceState,
			save: saveWorkspaceAction,
		},
		{
			select: (state, groupId, paneId) =>
				project("workspaceSelection", { state, groupId, paneId }),
			forRepository: (state, cwd) =>
				project("repositorySelection", { state, cwd }),
		},
		() => traceUi("selection-published"),
	);
}
