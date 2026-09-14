import type {
	AgentSavedState,
	AgentWorkspaceAction,
	WorkspaceSnapshot,
} from "@contracts";
import { WorkspaceReplica } from "@shared/lib/native.tsx";

export interface WorkspacePersistencePort {
	initialize(): Promise<AgentSavedState>;
	load(): Promise<AgentSavedState | null>;
	save(action: AgentWorkspaceAction): Promise<AgentSavedState>;
}
export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>;

/** JS owns the asynchronous queue; native state owns optimistic selection and rollback. */
export function createWorkspaceSession(
	port: WorkspacePersistencePort,
	onSnapshot: (snapshot: WorkspaceSnapshot) => void = () => {},
	onSelection?: () => void,
) {
	const model = new WorkspaceReplica();
	let snapshot: WorkspaceSnapshot = JSON.parse(model.snapshot());
	let queue: Promise<unknown> = Promise.resolve();
	let read: Promise<AgentSavedState | null> | null = null;
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
		load(): Promise<AgentSavedState | null> {
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
