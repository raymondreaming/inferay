import type {
	AgentWorkspaceAction,
	Group,
	Workspace,
	WorkspaceAgentKind,
	WorkspaceSnapshot,
} from "@contracts";
import { dispatchFocusAgentChatComposer } from "@shared/lib/dom.tsx";
import {
	loadDefaultChatSettings,
	project,
	saveStoredInput,
	WorkspaceReplica,
} from "@shared/lib/native.tsx";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	createStore,
	reconcile,
} from "solid-js";
import {
	addProjectRepository,
	openProjectRepository,
	projects,
	refreshProjects,
	saveProjectCommand,
	showProjectView,
} from "./useProjects.tsx";

interface WorkspacePersistencePort {
	initialize(): Promise<Workspace>;
	load(): Promise<Workspace | null>;
	save(action: AgentWorkspaceAction): Promise<Workspace>;
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
	let read: Promise<Workspace | null> | null = null;
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
		load(): Promise<Workspace | null> {
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

const [published, setPublished] = createStore<WorkspaceSnapshot>({
	state: null,
	error: null,
});
const [projectChats, setProjectChats] = createSignal<
	Record<string, { groupId: string; paneId: string }>
>({});
let configuredSession: WorkspaceSession | undefined;
export function configureWorkspaceState(
	port: WorkspacePersistencePort,
	onSelection?: () => void,
) {
	if (configuredSession)
		throw new Error("Workspace state is already configured");
	configuredSession = createWorkspaceSession(
		port,
		(next) => setPublished(reconcile(next, (item) => item.id)),
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
export async function mutateAgentWorkspaceState(action: AgentWorkspaceAction) {
	const projectId = projects.selectedId();
	const project = projects.catalog()?.projects.find((p) => p.id === projectId);
	if (action.type === "addPane" && !action.cwd && project)
		action = { ...action, cwd: project.directory };
	const rememberChat = (state: Workspace | null) => {
		const group = state?.groups.find((g) => g.id === state.selectedGroupId);
		if (projectId && group?.selectedPaneId) {
			const selection = { groupId: group.id, paneId: group.selectedPaneId };
			setProjectChats((current) => ({ ...current, [projectId]: selection }));
		}
	};
	const saving = workspaceSession().mutate(action);
	if (action.type === "selectPane" || action.type === "selectWorkspace")
		rememberChat(workspaceSession().snapshot.state);
	const saved = await saving;
	if (
		saved &&
		["addPane", "directorySelected", "addWorkspace"].includes(action.type)
	)
		rememberChat(saved);
	if (saved && action.type === "selectRepository")
		openProjectRepository(action.cwd);
	if (
		saved &&
		project &&
		["addPane", "directorySelected", "addWorkspace"].includes(action.type)
	) {
		const group = saved.groups.find((g) => g.id === saved.selectedGroupId);
		const paneId =
			action.type === "directorySelected"
				? action.paneId
				: group?.selectedPaneId;
		if (paneId)
			await saveProjectCommand({
				type: "associateConversation",
				projectId,
				paneId,
			});
		if (
			action.type === "directorySelected" &&
			action.path &&
			action.path !== project.directory &&
			!projects.catalog()?.repositoryPaths.includes(action.path)
		) {
			await addProjectRepository(project, action.path);
		}
		await refreshProjects();
	}
	return saved;
}
/** Selects a chat and focuses its composer after the workspace renders. */
export const openAgentPane = async (paneId: string) => {
	await mutateAgentWorkspaceState({ type: "selectPane", paneId });
	showProjectView("chat");
	requestAnimationFrame(() =>
		requestAnimationFrame(() => dispatchFocusAgentChatComposer(paneId)),
	);
};
export const findAgentPane = (paneId: string) => {
	for (const group of published.state?.groups ?? []) {
		const pane = group.panes.find((p) => p.id === paneId);
		if (pane) return { groupId: group.id, pane };
	}
	return undefined;
};
export const startAgentChatWithDraft = async (draft: string) => {
	const before = new Set(
		(published.state?.groups ?? []).flatMap((g) => g.panes.map((p) => p.id)),
	);
	await mutateAgentWorkspaceState({
		type: "addPane",
		agentKind: loadDefaultChatSettings().agentKind,
	});
	for (const group of published.state?.groups ?? []) {
		const pane = group.panes.find((p) => !before.has(p.id));
		if (!pane) continue;
		saveStoredInput(pane.id, draft);
		await openAgentPane(pane.id);
		return pane.id;
	}
	return undefined;
};
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
export interface SidebarChatEntry {
	groupId: Group["id"];
	pane: Group["panes"][number];
}
export interface SidebarWorkspaceState {
	entries: SidebarChatEntry[];
	groups: Group[];
	selectedGroupId: string | null;
}
const emptyGroups: Group[] = [];
const scopedGroups = createMemo(() => {
	const groups = published.state?.groups ?? emptyGroups;
	if (!projects.selectedId()) return groups;
	const catalog = projects.catalog();
	return groups
		.map((g) => ({
			...g,
			selectedPaneId:
				projectChats()[projects.selectedId()]?.groupId === g.id &&
				g.panes.some(
					(p) => p.id === projectChats()[projects.selectedId()]?.paneId,
				)
					? projectChats()[projects.selectedId()]!.paneId
					: g.selectedPaneId,
			panes: g.panes.filter(
				(p) =>
					catalog?.conversationProjects[p.id] === projects.selectedId() ||
					(!catalog?.conversationProjects[p.id] &&
						!!catalog?.repositoryPaths.includes(p.cwd ?? "")),
			),
		}))
		.filter((g) => g.panes.length > 0);
});
const visibleEntries = createMemo<SidebarChatEntry[]>(() => {
	const groups = scopedGroups();
	if (projects.selectedId())
		return groups.flatMap((g) =>
			g.panes.map((pane) => ({ groupId: g.id, pane })),
		);
	return project<[number, number][]>(
		"workspaceChatEntries",
		published.state,
	).map(([group, pane]) => ({
		groupId: groups[group]!.id,
		pane: groups[group]!.panes[pane]!,
	}));
});
export function useWorkspaceState(
	_loadCanonical: Accessor<boolean> = () => true,
	_selectFirst: Accessor<boolean> = () => true,
) {
	const state: SidebarWorkspaceState = {
		get groups() {
			return scopedGroups();
		},
		get entries() {
			return visibleEntries();
		},
		get selectedGroupId() {
			if (projects.selectedId()) {
				const groups = state.groups;
				const remembered = projectChats()[projects.selectedId()];
				return (
					groups.find((g) => g.id === remembered?.groupId)?.id ??
					groups.find((g) => g.id === published.state?.selectedGroupId)?.id ??
					groups[0]?.id ??
					null
				);
			}
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
	return [() => state, () => published.error] as const;
}
