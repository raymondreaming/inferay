import { traceUi } from "@shared/lib/native.tsx";
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
	configureWorkspacePanels(saveWorkspacePanel);
	configureWorkspaceState(
		{
			initialize: initializeWorkspaceState,
			load: loadWorkspaceState,
			save: saveWorkspaceAction,
		},
		() => traceUi("selection-published"),
	);
}
