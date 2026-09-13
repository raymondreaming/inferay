import type { PanelAction, PanelSession } from "@contracts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { listenWindowEvent, queryClient } from "@shared/lib/dom.tsx";
import {
	CLIENT_STORAGE_CHANGED_EVENT,
	emptyGitWorkspacePanelSession,
	readStoredJson,
	project as rustProject,
	writeStoredJson,
} from "@shared/lib/native.tsx";
import { useMutation } from "@tanstack/solid-query";
import {
	createWorkspacePanelModel,
	type PanelProjection,
	panelSessionQuery,
	type WorkspacePanelPort,
} from "@workspace/services/workspacePanels.ts";

let panelDependencies:
	| { send: WorkspacePanelPort; preview: PanelProjection }
	| undefined;
export function configureWorkspacePanels(
	send: WorkspacePanelPort,
	preview: PanelProjection,
) {
	if (panelDependencies)
		throw new Error("Workspace panels are already configured");
	panelDependencies = { send, preview };
}
function dependencies() {
	if (!panelDependencies)
		throw new Error("Configure workspace panels before mounting the app");
	return panelDependencies;
}
export function panelQuery(workspaceId: string) {
	return panelSessionQuery(workspaceId, dependencies().send);
}

import {
	type Accessor,
	createMemo,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";

type PanelVisibility = Pick<PanelSession, "graphVisible" | "sidebarVisible">;
const VISIBILITY_KEY = "agent-workspace-panel-visibility";
const loadPanelVisibility = () =>
	rustProject<PanelVisibility>(
		"panelVisibility",
		readStoredJson(VISIBILITY_KEY, {}),
	);
export function usePanelVisibility() {
	const [visibility, setVisibility] = createSignal(loadPanelVisibility);
	onSettled(() =>
		listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
			if ((event as CustomEvent<{ key: string }>).detail.key === VISIBILITY_KEY)
				setVisibility(loadPanelVisibility());
		}),
	);
	return visibility;
}
export function useWorkspacePanelSession(_workspaceId: Accessor<string>) {
	const visibility = usePanelVisibility();
	const model = createMemo(() => {
		const { send, preview } = dependencies();
		return createWorkspacePanelModel(
			queryClient,
			send,
			preview,
			emptyPanelSession,
		);
	});
	const query = useQuery(
		() => model().queryOptions(_workspaceId()),
		() => queryClient,
	);
	const mutation = useMutation(
		() => model().mutationOptions(_workspaceId()),
		() => queryClient,
	);
	const mutate = createMemo(() => mutation.mutate);
	const session = createMemo(() => {
		const value = { ...(query.data ?? emptyPanelSession), ...visibility() };
		return {
			...value,
			sidebarContent: rustProject<PanelSession["sidebarContent"]>(
				"panelSidebarContent",
				{
					graphVisible: value.graphVisible,
					mainViewMode: value.mainViewMode,
					selectedCommitHash: value.selectedCommitHash,
					selectedFile: value.selectedFile,
				},
			),
		};
	});
	// Commands snapshot their target when invoked, including from effect apply callbacks.
	const update = (action: PanelAction) =>
		untrack(() => {
			if (action.type === "toggleGraph" || action.type === "toggleSidebar") {
				// Read the shared preference directly so rapid toggles see pending writes.
				const next = rustProject<PanelSession>("panelPreview", {
					session: { ...session(), ...loadPanelVisibility() },
					action,
					now: Date.now(),
				});
				writeStoredJson(VISIBILITY_KEY, {
					graphVisible: next.graphVisible,
					sidebarVisible: next.sidebarVisible,
				});
				if (action.type === "toggleSidebar" || !next.graphVisible) return;
				action = { type: "openGraph", cwd: action.cwd };
			}
			if (action.type === "openGraph")
				writeStoredJson(VISIBILITY_KEY, {
					...loadPanelVisibility(),
					graphVisible: true,
				});
			mutate()(model().preview(_workspaceId(), action));
		});
	const error = createMemo(() =>
		query.error
			? "Saved workspace panels could not be restored."
			: mutation.error
				? "Some workspace panel changes could not be saved."
				: null,
	);
	return [
		session,
		update,
		() => error(),
		() => mutation.data?.announcement,
	] as const;
}
export const emptyPanelSession = emptyGitWorkspacePanelSession();
