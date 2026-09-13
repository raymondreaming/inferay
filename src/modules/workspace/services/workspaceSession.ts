import type { AgentSavedState } from "@contracts";
import type {
	AgentWorkspaceAction,
	WorkspaceSnapshot,
} from "@workspace/model/workspace.ts";

export interface WorkspacePersistencePort {
	initialize(): Promise<AgentSavedState>;
	load(): Promise<AgentSavedState | null>;
	save(action: AgentWorkspaceAction): Promise<AgentSavedState>;
}

/** Serializes persistence while publishing optimistic selection immediately. */
export function createWorkspaceSession(
	port: WorkspacePersistencePort,
	project: <T>(operation: string, input: unknown) => T,
	onSnapshot: (snapshot: WorkspaceSnapshot) => void = () => {},
	onSelection?: () => void,
) {
	let snapshot: WorkspaceSnapshot = {
		state: null,
		error: null,
	};
	let canonicalState: AgentSavedState | null = null;
	const publish = (next: WorkspaceSnapshot) => {
		snapshot = next;
		onSnapshot(next);
	};
	let queue: Promise<unknown> = Promise.resolve();
	let read: Promise<AgentSavedState | null> | null = null;
	let selectionRequest = 0;
	let queuedStructuralChanges = 0;
	let pendingSelection: {
		id: number;
		groupId: string;
		paneId?: string;
	} | null = null;
	function selected(
		state: AgentSavedState,
		groupId: string,
		paneId?: string,
	): AgentSavedState {
		return project("workspaceSelection", {
			state,
			groupId,
			paneId,
		});
	}
	function loadAgentState() {
		return snapshot.state;
	}
	function accept(state: AgentSavedState, saved = false) {
		canonicalState = state;
		const pending = pendingSelection;
		publish({
			state: pending ? selected(state, pending.groupId, pending.paneId) : state,
			error: saved ? null : snapshot.error,
		});
	}
	async function initializeAgentState() {
		const state = await port.initialize();
		accept(state, true);
		return state;
	}
	function loadCanonicalAgentState(): Promise<AgentSavedState | null> {
		if (read) return read;
		const current = queue.then(async () => {
			try {
				const state = await port.load();
				if (state) accept(state, true);
				return loadAgentState();
			} catch {
				publish({
					...snapshot,
					error: "Saved workspaces could not be loaded.",
				});
				return snapshot.state;
			}
		});
		const tracked = current.finally(() => {
			if (read === tracked) read = null;
		});
		read = tracked;
		queue = read.catch(() => {});
		return current;
	}
	function mutateAgentWorkspaceState(
		action:
			| AgentWorkspaceAction
			| ((state: AgentSavedState) => AgentWorkspaceAction | null),
	) {
		const requestId = ++selectionRequest;
		const selection =
			typeof action === "function"
				? null
				: action.type === "selectRepository" && snapshot.state
					? project<{ groupId: string; paneId: string } | null>(
							"repositorySelection",
							{ state: snapshot.state, cwd: action.cwd },
						)
					: action.type === "selectPane" || action.type === "selectWorkspace"
						? {
								groupId: action.groupId,
								paneId:
									action.type === "selectPane" ? action.paneId : undefined,
							}
						: null;
		// Repeated focus clicks should not persist the same selection or delay a new
		// pane. A queued structural action may change selection, so keep ordering then.
		if (selection && queuedStructuralChanges === 0 && !snapshot.error) {
			const state = snapshot.state;
			const group = state?.groups.find(
				(group) => group.id === selection.groupId,
			);
			if (
				state?.selectedGroupId === selection.groupId &&
				group &&
				(selection.paneId === undefined ||
					group.selectedPaneId === selection.paneId)
			)
				return Promise.resolve(state);
		}
		const structural = selection === null;
		if (structural) queuedStructuralChanges++;
		if (selection) {
			pendingSelection = { id: requestId, ...selection };
			const state = snapshot.state;
			if (state)
				publish({
					...snapshot,
					state: selected(state, selection.groupId, selection.paneId),
				});
		}
		if (selection) onSelection?.();
		const mutation = queue.then(async () => {
			const current = snapshot.state ?? (await initializeAgentState()),
				next = typeof action === "function" ? action(current) : action;
			if (!next) return null;
			try {
				const state = await port.save(next);
				if (pendingSelection?.id === requestId) pendingSelection = null;
				accept(state, true);
				return loadAgentState();
			} catch {
				if (pendingSelection?.id === requestId) pendingSelection = null;
				if (canonicalState) accept(canonicalState);
				publish({
					...snapshot,
					error: "Workspace changes could not be saved.",
				});
				return null;
			}
		});
		const settled = mutation.finally(() => {
			if (structural) queuedStructuralChanges--;
		});
		queue = settled.catch(() => {});
		return settled;
	}

	return {
		initialize: initializeAgentState,
		load: loadCanonicalAgentState,
		mutate: mutateAgentWorkspaceState,
		publish,
		get snapshot() {
			return snapshot;
		},
	};
}
