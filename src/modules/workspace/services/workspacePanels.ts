import type { PanelAction, PanelSession } from "@contracts";
import type { QueryClient } from "@tanstack/query-core";

export type WorkspacePanelPort = (input: {
	workspaceId: string;
	action?: PanelAction;
}) => Promise<{
	session: PanelSession;
	announcement?: string | null;
}>;
export type PanelProjection = (
	session: PanelSession,
	action: PanelAction,
	now: number,
) => PanelSession;

export function panelSessionQuery(
	workspaceId: string,
	send: WorkspacePanelPort,
) {
	return {
		queryKey: ["workspace-panels", workspaceId],
		queryFn: async () => (await send({ workspaceId })).session,
		staleTime: Infinity,
		gcTime: 30 * 60 * 1000,
	};
}
export function createWorkspacePanelModel(
	client: QueryClient,
	send: WorkspacePanelPort,
	preview: PanelProjection,
	emptyPanelSession: PanelSession,
) {
	type PendingAction = {
		workspaceId: string;
		action: PanelAction;
		sequence: number;
		now: number;
	};
	type Workspace = {
		canonical: PanelSession;
		pending: PendingAction[];
		revision: number;
	};
	const workspaces = new Map<string, Workspace>();
	let sequence = 0;
	const key = (workspaceId: string) => ["workspace-panels", workspaceId];
	const current = (workspaceId: string) =>
		client.getQueryData<PanelSession>(key(workspaceId)) ?? emptyPanelSession;
	const state = (workspaceId: string) => {
		let workspace = workspaces.get(workspaceId);
		if (!workspace) {
			workspace = {
				canonical: current(workspaceId),
				pending: [],
				revision: 0,
			};
			workspaces.set(workspaceId, workspace);
		}
		return workspace;
	};
	const project = (
		session: PanelSession,
		request: PendingAction,
	): PanelSession => {
		// File content belongs to the renderer cache, never to panel transitions.
		const action = {
			...request.action,
		};
		if (action.type === "detachFile") delete action.initialFile;
		return preview(
			{
				...session,
				detachedFilePanels: session.detachedFilePanels.map(
					({ initialFile: _, ...panel }) => panel,
				),
			},
			action,
			request.now,
		);
	};
	const retainInitialFiles = (
		workspaceId: string,
		session: PanelSession,
	): PanelSession => {
		const cached = current(workspaceId);
		const pending = state(workspaceId).pending;
		const initialFiles = new Map(
			cached.detachedFilePanels.map((panel) => [panel.id, panel.initialFile]),
		);
		for (const { action } of pending)
			if (action.type === "detachFile" && action.initialFile)
				initialFiles.set(action.id, action.initialFile);
		return {
			...session,
			detachedFilePanels: session.detachedFilePanels.map((panel) => ({
				...panel,
				initialFile: initialFiles.get(panel.id),
			})),
		};
	};
	const publish = (workspaceId: string, session: PanelSession) =>
		client.setQueryData(
			key(workspaceId),
			retainInitialFiles(workspaceId, session),
		);
	const settle = (request: PendingAction, canonical?: PanelSession) => {
		const workspace = state(request.workspaceId);
		workspace.pending = workspace.pending.filter(
			(pending) => pending.sequence !== request.sequence,
		);
		if (canonical) {
			workspace.canonical = canonical;
			workspace.revision++;
		}
		// A slow acknowledgement must not move selection behind newer clicks.
		publish(
			request.workspaceId,
			workspace.pending.reduce(project, workspace.canonical),
		);
	};
	return {
		queryOptions(workspaceId: string) {
			const options = panelSessionQuery(workspaceId, send);
			return {
				...options,
				queryFn: async () => {
					const workspace = state(workspaceId);
					const started = workspace.revision;
					const session = await options.queryFn();
					if (workspace.revision !== started) return current(workspaceId);
					workspace.canonical = session;
					return retainInitialFiles(
						workspaceId,
						workspace.pending.reduce(project, session),
					);
				},
			};
		},
		mutationOptions: (workspaceId: string) => ({
			mutationKey: ["workspace-panels", workspaceId],
			scope: {
				id: `workspace-panels:${workspaceId}`,
			},
			mutationFn: async ({ workspaceId, action }: PendingAction) => {
				const wireAction = {
					...action,
				};
				if (wireAction.type === "detachFile") delete wireAction.initialFile;
				return send({ workspaceId, action: wireAction });
			},
			onSuccess: (
				{
					session,
				}: {
					session: PanelSession;
				},
				request: PendingAction,
			) => settle(request, session),
			onError: (_error: unknown, request: PendingAction) => settle(request),
		}),
		preview(workspaceId: string, action: PanelAction): PendingAction {
			const request = {
				workspaceId,
				action,
				sequence: ++sequence,
				now: Date.now(),
			};
			const workspace = state(workspaceId);
			if (workspace.pending.length === 0)
				workspace.canonical = current(workspaceId);
			const next = project(current(workspaceId), request);
			workspace.pending.push(request);
			publish(workspaceId, next);
			return request;
		},
	};
}
