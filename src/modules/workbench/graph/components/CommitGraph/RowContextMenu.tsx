import * as stylex from "@octanejs/stylex";
import * as inlineStyles from "./styles.ts";

import { styles } from "./styles.ts";

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
	return (
		<div
			role="menu"
			aria-label={`Actions for ${itemContextMenu.item.message}`}
			{...stylex.props(styles.refContextMenu)}
			style={inlineStyles.getCommitGraphRefContextMenuStyle1(
				itemContextMenu.x,
				itemContextMenu.y,
			)}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div {...stylex.props(styles.refContextTitle)}>
				{itemContextMenu.item.itemKind === "worktreeWip"
					? "Uncommitted changes"
					: itemContextMenu.item.message}
			</div>
			{itemContextMenu.item.itemKind !== "worktreeWip" ? (
				<>
					{itemContextMenu.item.itemKind === "commit" && onCompareWithWip ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onCompareWithWip(itemContextMenu.item.id);
								setItemContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Compare commit with WIP
						</button>
					) : null}
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							void navigator.clipboard.writeText(itemContextMenu.item.hash);
							setItemContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						Copy full SHA
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							void navigator.clipboard.writeText(
								itemContextMenu.item.hash.slice(0, 7),
							);
							setItemContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						Copy abbreviated SHA
					</button>
				</>
			) : null}
			{(itemContextMenu.item.itemKind === "worktreeWip"
				? itemContextMenu.item.id === "wip"
					? (["stashPush"] as const)
					: ([] as const)
				: itemContextMenu.item.itemKind === "stash"
					? (["stashApply", "stashPop", "stashRename", "stashDrop"] as const)
					: ([
							"createBranch",
							"createTag",
							"cherryPick",
							"revert",
							"resetSoft",
							"resetMixed",
							"resetHard",
						] as const)
			).map((action) => {
				const labels = {
					createBranch: "Create branch here…",
					createTag: "Create tag here…",
					cherryPick:
						selectedIds.length > 1 &&
						selectedIds.includes(itemContextMenu.item.id)
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
				} as const;
				return (
					<button
						key={action}
						type="button"
						role="menuitem"
						onClick={() => {
							const targets =
								action === "cherryPick" &&
								selectedIds.length > 1 &&
								selectedIds.includes(itemContextMenu.item.id)
									? commits
											.filter(
												(commit) =>
													commit.itemKind === "commit" &&
													selectedIds.includes(commit.id),
											)
											.reverse()
											.map((commit) => commit.hash)
									: undefined;
							onGraphAction?.({
								action,
								target:
									itemContextMenu.item.itemKind === "stash"
										? itemContextMenu.item.stashName
										: itemContextMenu.item.hash,
								itemId: itemContextMenu.item.id,
								targets,
							});
							setItemContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						{labels[action]}
					</button>
				);
			})}
		</div>
	);
}
