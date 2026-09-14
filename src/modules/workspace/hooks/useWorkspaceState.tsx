import type {
	AgentWorkspaceAction,
	Group,
	RepositoryWorkspaceIndex,
	WorkspaceAgentKind,
	WorkspaceSnapshot,
} from "@contracts";
import { WorkspaceReplica } from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createStore,
	reconcile,
	snapshot as storeSnapshot,
} from "solid-js";

export interface WorkspacePersistencePort {
	initialize(): Promise<import("@contracts").AgentSavedState>;
	load(): Promise<import("@contracts").AgentSavedState | null>;
	save(
		action: AgentWorkspaceAction,
	): Promise<import("@contracts").AgentSavedState>;
}

type WorkspaceSession = ReturnType<typeof createWorkspaceSession>;

/** Sequences persistence while the native replica owns optimistic state and rollback. */
export function createWorkspaceSession(
	port: WorkspacePersistencePort,
	onSnapshot: (snapshot: WorkspaceSnapshot) => void = () => {},
	onSelection?: () => void,
) {
	const model = new WorkspaceReplica();
	let snapshot: WorkspaceSnapshot = JSON.parse(model.snapshot());
	let queue: Promise<unknown> = Promise.resolve();
	let read: Promise<import("@contracts").AgentSavedState | null> | null = null;
	const publish = (next: string) => {
		snapshot = JSON.parse(next);
		onSnapshot(snapshot);
	};
	async function initialize() {
		const state = await port.initialize();
		publish(model.accept(JSON.stringify(state), undefined));
		return snapshot.state!;
	}
	return {
		initialize,
		get snapshot() {
			return snapshot;
		},
		publish(next: WorkspaceSnapshot) {
			publish(model.publish(JSON.stringify(next)));
		},
		load(): Promise<import("@contracts").AgentSavedState | null> {
			if (read) return read;
			const current = queue.then(async () => {
				try {
					const state = await port.load();
					publish(
						state
							? model.accept(JSON.stringify(state), undefined)
							: model.snapshot(),
					);
				} catch {
					publish(model.fail(undefined));
				}
				return snapshot.state;
			});
			read = current.finally(() => {
				read = null;
			});
			queue = read.catch(() => {});
			return current;
		},
		mutate(action: AgentWorkspaceAction) {
			const request: { id: number; selecting: boolean } | null = JSON.parse(
				model.begin(JSON.stringify(action)),
			);
			if (!request) return Promise.resolve(snapshot.state);
			if (request.selecting) {
				publish(model.snapshot());
				onSelection?.();
			}
			const mutation = queue
				.then(async () => {
					if (!snapshot.state) await initialize();
					try {
						publish(
							model.accept(JSON.stringify(await port.save(action)), request.id),
						);
						return snapshot.state;
					} catch {
						publish(model.fail(request.id));
						return null;
					}
				})
				.finally(() => model.settled(request.id));
			queue = mutation.catch(() => {});
			return mutation;
		},
	};
}

const EMPTY: RepositoryWorkspaceIndex = {
	workspaces: [],
	unassignedEntries: [],
	activePath: null,
	activeWorkspace: null,
	visibleEntries: [],
};
const [published, setPublished] = createStore<WorkspaceSnapshot>({
	state: null,
	error: null,
});
let configuredSession: WorkspaceSession | undefined;
export function configureWorkspaceState(
	port: WorkspacePersistencePort,
	onSelection?: () => void,
) {
	if (configuredSession)
		throw new Error("Workspace state is already configured");
	configuredSession = createWorkspaceSession(
		port,
		(next) =>
			setPublished(
				reconcile(next, (item) => item.id ?? item.cwd ?? item.pane?.id),
			),
		onSelection,
	);
}
function workspaceSession(): WorkspaceSession {
	if (!configuredSession)
		throw new Error("Configure workspace state before mounting the app");
	return configuredSession;
}
export const initializeAgentState = () => workspaceSession().initialize();
export const loadCanonicalAgentState = () => workspaceSession().load();
export const mutateAgentWorkspaceState = (action: AgentWorkspaceAction) =>
	workspaceSession().mutate(action);
export const changePaneAgentKind = (
	paneId: string,
	agentKind: WorkspaceAgentKind,
) => {
	void mutateAgentWorkspaceState({
		type: "changePaneAgentKind",
		paneId,
		agentKind,
	});
};
export interface SidebarWorkspaceState {
	repositories: RepositoryWorkspaceIndex;
	groups: Group[];
	selectedGroupId: string | null;
}
export function useWorkspaceState(
	_loadCanonical: Accessor<boolean> = () => true,
	_selectFirst: Accessor<boolean> = () => true,
) {
	const emptyGroups: Group[] = [];
	const state: SidebarWorkspaceState = {
		get groups() {
			return published.state?.groups ?? emptyGroups;
		},
		get repositories() {
			return published.state?.repositories ?? EMPTY;
		},
		get selectedGroupId() {
			return (
				published.state?.selectedGroupId ??
				(_selectFirst() ? published.state?.groups[0]?.id : null) ??
				null
			);
		},
	};
	createEffect(_loadCanonical, (load) => {
		if (load) void loadCanonicalAgentState();
	});
	const setState = (
		update:
			| SidebarWorkspaceState
			| ((state: SidebarWorkspaceState) => SidebarWorkspaceState),
	) => {
		const session = workspaceSession();
		const current = session.snapshot.state;
		if (!current) return;
		const next = storeSnapshot(
			typeof update === "function"
				? update({
						groups: current.groups,
						repositories: current.repositories,
						selectedGroupId: current.selectedGroupId,
					})
				: update,
		);
		session.publish({
			...session.snapshot,
			state: {
				...current,
				...next,
				selectedGroupId: next.selectedGroupId ?? current.selectedGroupId,
			},
		});
	};
	return [() => state, setState, () => published.error] as const;
}
