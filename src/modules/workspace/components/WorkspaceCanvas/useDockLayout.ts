import type { DockLayout, DockRequest, DockTree } from "@contracts";
import { DockSession, readStoredValue } from "@shared/lib/native.tsx";
import { saveWorkspaceDock } from "@workspace/services/workspaceApi.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";

/** Persists dock layouts sequentially while exposing the latest rendered tree. */
export function useDockLayout(
	input: Accessor<DockRequest>,
	active: Accessor<boolean>,
) {
	const model = new DockSession();
	const begin = (
		request: DockRequest,
		deduplicate = false,
	): {
		revision: number;
		layout: DockLayout | null;
		persist: boolean;
	} | null => {
		const read = (prefix: string) =>
			readStoredValue(`${prefix}:${request.workspaceId}`) ??
			(request.legacyWorkspaceId
				? readStoredValue(`${prefix}:${request.legacyWorkspaceId}`)
				: null) ??
			undefined;
		return JSON.parse(
			model.begin(
				JSON.stringify(request),
				read("native-workspace-dock"),
				read("agent-workspace-dock"),
				deduplicate,
			),
		);
	};
	const initial = begin(untrack(input))!;
	const [layout, setLayout] = createSignal<DockLayout>(initial.layout!);
	const tree = createMemo(() => layout().tree);
	const [error, setError] = createSignal<string | null>(null);
	const requests = { current: Promise.resolve() };
	const update = (
		action?: Record<string, unknown>,
		target = input(),
		deduplicate = false,
	) => {
		const request = { ...target, action };
		const pending = begin(request, deduplicate);
		if (!pending) return Promise.resolve(true);
		if (pending.layout) setLayout(pending.layout);
		if (!pending.persist) return Promise.resolve(true);
		const result = requests.current.then(async () => {
			if (deduplicate && !model.is_current(pending.revision)) return true;
			try {
				const saved = await saveWorkspaceDock<DockLayout>(request);
				const accepted: DockLayout | null = JSON.parse(
					model.accept(
						pending.revision,
						request.workspaceId,
						JSON.stringify(saved),
					),
				);
				if (accepted?.canvas && "tree" in accepted) {
					setLayout(accepted);
				}
				if (model.is_current(pending.revision)) setError(null);
				return true;
			} catch {
				if (model.fail(pending.revision))
					setError("Could not save pane layout. Please retry.");
				return false;
			}
		});
		requests.current = result.then(() => {});
		return result;
	};
	createEffect(
		() => (active() ? input() : null),
		(target) => {
			if (target) void update(undefined, target, true);
		},
	);
	onSettled(() => () => {
		model.dispose();
		void requests.current.then(() => model.free());
	});
	const treeRef = { current: untrack(tree) } as { current: DockTree | null };
	createEffect(tree, (next) => {
		treeRef.current = next;
	});
	return { error, layout, setLayout, tree, treeRef, update };
}
