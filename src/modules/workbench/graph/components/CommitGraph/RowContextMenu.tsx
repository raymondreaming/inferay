import { createMemo } from "solid-js";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu.tsx";
import type { useCommitGraphState } from "./useCommitGraphState.tsx";

type RowContextMenuProps = {
	itemContextMenu: NonNullable<
		ReturnType<typeof useCommitGraphState>["itemContextMenu"]
	>;
} & Pick<
	ReturnType<typeof useCommitGraphState>,
	| "onCompareWithWip"
	| "setItemContextMenu"
	| "selectedIds"
	| "commits"
	| "onGraphAction"
>;
export function RowContextMenu(_props: RowContextMenuProps) {
	const item = createMemo(() => _props.itemContextMenu.item);
	const entries = createMemo(() => {
		const entries: ContextMenuEntry[] = [];
		const multiple = createMemo(
			() =>
				_props.selectedIds.length > 1 && _props.selectedIds.includes(item().id),
		);
		if (item().itemKind !== "worktreeWip") {
			if (item().itemKind === "commit" && _props.onCompareWithWip)
				entries.push({
					label: "Compare commit with WIP",
					run: () => _props.onCompareWithWip?.(item().id),
				});
			for (const [label, hash] of [
				["Copy full SHA", item().hash],
				["Copy abbreviated SHA", item().hash.slice(0, 7)],
			] as const)
				entries.push({
					label,
					run: () => {
						void navigator.clipboard.writeText(hash);
					},
				});
		}
		const labels = createMemo(() => ({
			createBranch: "Create branch here…",
			createTag: "Create tag here…",
			cherryPick: multiple()
				? `Cherry-pick ${_props.selectedIds.length} commits…`
				: "Cherry-pick commit…",
			revert: "Revert commit…",
			stashPush: "Stash changes…",
			stashApply: "Apply stash…",
			stashPop: "Pop stash…",
			stashRename: "Rename stash…",
			stashDrop: "Delete stash…",
			resetSoft: "Reset branch here (soft)…",
			resetMixed: "Reset branch here (mixed)…",
			resetHard: "Reset branch here (hard)…",
		}));
		const actions = createMemo<Array<keyof ReturnType<typeof labels>>>(() => {
			const _itemValue = item();
			return _itemValue.itemKind === "worktreeWip"
				? _itemValue.id === "wip"
					? ["stashPush"]
					: []
				: _itemValue.itemKind === "stash"
					? ["stashApply", "stashPop", "stashRename", "stashDrop"]
					: [
							"createBranch",
							"createTag",
							"cherryPick",
							"revert",
							"resetSoft",
							"resetMixed",
							"resetHard",
						];
		});
		for (const action of actions())
			entries.push({
				label: labels()[action],
				run: () => {
					const _itemValue2 = item();
					return _props.onGraphAction?.({
						action,
						target:
							_itemValue2.itemKind === "stash"
								? _itemValue2.stashName
								: _itemValue2.hash,
						itemId: _itemValue2.id,
						targets:
							action === "cherryPick" && multiple()
								? _props.commits
										.filter(
											(commit) =>
												commit.itemKind === "commit" &&
												_props.selectedIds.includes(commit.id),
										)
										.reverse()
										.map((commit) => commit.hash)
								: undefined,
					});
				},
			});
		return entries;
	});
	return (
		<ContextMenu
			x={_props.itemContextMenu.x}
			y={_props.itemContextMenu.y}
			title={
				item().itemKind === "worktreeWip"
					? "Uncommitted changes"
					: item().message
			}
			label={item().message}
			entries={entries()}
			onClose={() => _props.setItemContextMenu(null)}
		/>
	);
}
