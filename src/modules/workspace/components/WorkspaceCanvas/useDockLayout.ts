import type { DockLayout, DockRequest, DockTree } from "@contracts";
import { DockSession } from "@shared/lib/native.tsx";
import { saveWorkspaceDock } from "@workspace/services/workspaceApi.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";
import { beginDockLayout } from "./dockLayoutCache.ts";

/** Persists dock layouts sequentially while exposing the latest rendered tree. */
export function useDockLayout(
	input: Accessor<DockRequest>,
	active: Accessor<boolean>,
) {
	const model = new DockSession();
	const initial = beginDockLayout(model, untrack(input))!;
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
		const pending = beginDockLayout(model, request, deduplicate);
		if (!pending) return Promise.resolve(true);
		if (pending.layout) setLayout(pending.layout);
		const result = requests.current.then(async () => {
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
					setError(null);
				}
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
