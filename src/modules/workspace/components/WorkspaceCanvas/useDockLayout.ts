import { saveWorkspaceDock } from "@workspace/services/workspaceApi.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onSettled,
	untrack,
} from "solid-js";
import {
	type DockLayout,
	previewDockLayout,
	rememberDockLayout,
} from "./dockLayoutCache.ts";
import type { DockTree } from "./dockTypes.ts";

type DockInput = Parameters<typeof previewDockLayout>[0];

/** Persists dock layouts sequentially while exposing the latest rendered tree. */
export function useDockLayout(
	input: Accessor<DockInput>,
	active: Accessor<boolean>,
) {
	const [layout, setLayout] = createSignal<DockLayout>(() =>
		previewDockLayout(input()),
	);
	const tree = createMemo(() => layout().tree);
	const [error, setError] = createSignal<string | null>(null);
	const revision = { current: 0 };
	const requests = { current: Promise.resolve() };
	let lastRequested: string | null = null;
	const update = (action?: object, target = input()) => {
		const requestRevision = ++revision.current;
		const request = { ...target, action };
		if (!action) setLayout(previewDockLayout(request));
		const result = requests.current.then(async () => {
			try {
				const saved = await saveWorkspaceDock<DockLayout>(request);
				rememberDockLayout(request.workspaceId, saved);
				if (requestRevision === revision.current) {
					setLayout(saved);
					setError(null);
				}
				return true;
			} catch {
				if (requestRevision === revision.current) {
					lastRequested = null;
					setError("Could not save pane layout. Please retry.");
				}
				return false;
			}
		});
		requests.current = result.then(() => {});
		return result;
	};
	createEffect(
		() => (active() ? JSON.stringify(input()) : null),
		(key) => {
			if (!key || key === lastRequested) return;
			lastRequested = key;
			void update(undefined, JSON.parse(key) as DockInput);
		},
	);
	onSettled(() => () => {
		revision.current++;
	});
	const treeRef = { current: untrack(tree) } as { current: DockTree | null };
	createEffect(tree, (next) => {
		treeRef.current = next;
	});
	return { error, layout, setLayout, tree, treeRef, update };
}
