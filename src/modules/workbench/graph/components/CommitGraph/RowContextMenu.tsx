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
export function RowContextMenu({
	itemContextMenu,
	onCompareWithWip,
	setItemContextMenu,
	selectedIds,
	commits,
	onGraphAction,
}: RowContextMenuProps) {
	const item = itemContextMenu.item;
	const entries: ContextMenuEntry[] = [];
	const multiple = selectedIds.length > 1 && selectedIds.includes(item.id);
	if (item.itemKind !== "worktreeWip") {
		if (item.itemKind === "commit" && onCompareWithWip)
			entries.push({
				label: "Compare commit with WIP",
				run: () => onCompareWithWip(item.id),
			});
		for (const [label, hash] of [
			["Copy full SHA", item.hash],
			["Copy abbreviated SHA", item.hash.slice(0, 7)],
		] as const)
			entries.push({
				label,
				run: () => {
					void navigator.clipboard.writeText(hash);
				},
			});
	}
	const labels = {
		createBranch: "Create branch here…",
		createTag: "Create tag here…",
		cherryPick: multiple
			? `Cherry-pick ${selectedIds.length} commits…`
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
	};
	const actions: Array<keyof typeof labels> =
		item.itemKind === "worktreeWip"
			? item.id === "wip"
				? ["stashPush"]
				: []
			: item.itemKind === "stash"
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
	for (const action of actions)
		entries.push({
			label: labels[action],
			run: () =>
				onGraphAction?.({
					action,
					target: item.itemKind === "stash" ? item.stashName : item.hash,
					itemId: item.id,
					targets:
						action === "cherryPick" && multiple
							? commits
									.filter(
										(commit) =>
											commit.itemKind === "commit" &&
											selectedIds.includes(commit.id),
									)
									.reverse()
									.map((commit) => commit.hash)
							: undefined,
				}),
		});
	return (
		<ContextMenu
			x={itemContextMenu.x}
			y={itemContextMenu.y}
			title={
				item.itemKind === "worktreeWip" ? "Uncommitted changes" : item.message
			}
			label={item.message}
			entries={entries}
			onClose={() => setItemContextMenu(null)}
		/>
	);
}
