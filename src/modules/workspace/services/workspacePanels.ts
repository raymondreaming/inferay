import type { PanelAction, PanelSession } from "@contracts";
import { PanelReplica } from "@shared/lib/native.tsx";
import type { QueryClient } from "@tanstack/query-core";

export type WorkspacePanelPort = (input: {
	workspaceId: string;
	action?: PanelAction;
}) => Promise<{ session: PanelSession; announcement?: string | null }>;
type PanelRequest = {
	workspaceId: string;
	action: PanelAction;
	sequence: number;
};
const parse = <T>(value: string): T => JSON.parse(value);

export const panelSessionQuery = (
	workspaceId: string,
	send: WorkspacePanelPort,
) => ({
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
		client.setQueryData(key(id), restoreFiles(id, parse(serialized)));
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
