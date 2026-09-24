import type { PanelAction, PanelSession } from "@contracts";
import { useBackgroundQuery as useQuery } from "@shared/hooks/useQueryResource.tsx";
import { listenWindowEvent, queryClient } from "@shared/lib/dom.tsx";
import {
	CLIENT_STORAGE_CHANGED_EVENT,
	emptyGitWorkspacePanelSession,
	PanelReplica,
	readStoredJson,
	project as rustProject,
	writeStoredJson,
} from "@shared/lib/native.tsx";
import type { QueryClient } from "@tanstack/query-core";
import { useMutation } from "@tanstack/solid-query";

export type WorkspacePanelPort = (input: {
	workspaceId: string;
	action?: PanelAction;
}) => Promise<{ session: PanelSession; announcement?: string | null }>;
type PanelRequest = {
	workspaceId: string;
	action: PanelAction;
	sequence: number;
};
const parse = <T,>(value: string): T => JSON.parse(value);

const panelSessionQuery = (workspaceId: string, send: WorkspacePanelPort) => ({
	queryKey: ["workspace-panels", workspaceId],
	queryFn: async () => (await send({ workspaceId })).session,
	staleTime: Infinity,
	gcTime: 30 * 60 * 1000,
});

export function createWorkspacePanelModel(
	client: QueryClient,
	send: WorkspacePanelPort,
	empty: PanelSession,
) {
	const replica = new PanelReplica();
	const key = (id: string) => ["workspace-panels", id];
	const current = (id: string) =>
		client.getQueryData<PanelSession>(key(id)) ?? empty;
	let disposed = false;
	let active = 0;
	const release = () => {
		if (--active === 0 && disposed) replica.free();
	};
	const restoreFiles = (id: string, session: PanelSession) => {
		const files = new Map(
			current(id).detachedFilePanels.map(({ id, initialFile }) => [
				id,
				initialFile,
			]),
		);
		return {
			...session,
			detachedFilePanels: session.detachedFilePanels.map((panel) => ({
				...panel,
				initialFile: files.get(panel.id),
			})),
		};
	};
	const publish = (id: string, serialized: string) =>
		client.setQueryData(
			key(id),
			restoreFiles(id, parse<PanelSession>(serialized)),
		);
	const settle = (request: PanelRequest, session?: PanelSession) => {
		try {
			return publish(
				request.workspaceId,
				replica.settle(
					request.workspaceId,
					request.sequence,
					session && JSON.stringify(session),
				),
			);
		} finally {
			release();
		}
	};
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			if (active === 0) replica.free();
		},
		queryOptions(workspaceId: string) {
			return {
				...panelSessionQuery(workspaceId, send),
				queryFn: async () => {
					if (disposed) return current(workspaceId);
					active++;
					try {
						const revision = replica.revision(workspaceId);
						const { session } = await send({ workspaceId });
						return restoreFiles(
							workspaceId,
							parse(
								replica.load(workspaceId, revision, JSON.stringify(session)),
							),
						);
					} finally {
						release();
					}
				},
			};
		},
		mutationOptions: (workspaceId: string) => ({
			mutationKey: key(workspaceId),
			scope: { id: `workspace-panels:${workspaceId}` },
			mutationFn: ({ workspaceId, action }: PanelRequest) =>
				send({ workspaceId, action }),
			onSuccess: (
				{ session }: { session: PanelSession },
				request: PanelRequest,
			) => settle(request, session),
			onError: (_error: unknown, request: PanelRequest) => settle(request),
		}),
		preview(workspaceId: string, action: PanelAction): PanelRequest {
			if (disposed) throw new Error("Workspace panel model is disposed");
			const wireAction = { ...action };
			if (wireAction.type === "detachFile") delete wireAction.initialFile;
			const session = current(workspaceId);
			const preview: { sequence: number; session: PanelSession } = parse(
				replica.preview(
					workspaceId,
					JSON.stringify(wireAction),
					Date.now(),
					JSON.stringify({
						...session,
						detachedFilePanels: session.detachedFilePanels.map(
							({ initialFile: _, ...panel }) => panel,
						),
					}),
				),
			);
			active++;
			const next = restoreFiles(workspaceId, preview.session);
			if (action.type === "detachFile") {
				const panel = next.detachedFilePanels.find(
					({ id }) => id === action.id,
				);
				if (panel) panel.initialFile = action.initialFile;
			}
			client.setQueryData(key(workspaceId), next);
			return { workspaceId, action: wireAction, sequence: preview.sequence };
		},
	};
}

let panelDependencies: { send: WorkspacePanelPort } | undefined;
export function configureWorkspacePanels(send: WorkspacePanelPort) {
	if (panelDependencies)
		throw new Error("Workspace panels are already configured");
	panelDependencies = { send };
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
	onCleanup,
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
	const model = createWorkspacePanelModel(
		queryClient,
		dependencies().send,
		emptyPanelSession,
	);
	onCleanup(() => model.dispose());
	const query = useQuery(
		() => model.queryOptions(_workspaceId()),
		() => queryClient,
	);
	const mutation = useMutation(
		() => model.mutationOptions(_workspaceId()),
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
			mutate()(model.preview(_workspaceId(), action));
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
