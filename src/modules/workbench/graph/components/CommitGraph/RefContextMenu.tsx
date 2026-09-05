import * as stylex from "@octanejs/stylex";
import * as inlineStyles from "./styles.ts";

import { styles } from "./styles.ts";

import type { useCommitGraphState } from "./useCommitGraphState.tsx";

type RefContextMenuProps = {
	refContextMenu: NonNullable<
		ReturnType<typeof useCommitGraphState>["refContextMenu"]
	>;
} & Pick<
	ReturnType<typeof useCommitGraphState>,
	| "onCheckoutRef"
	| "setRefContextMenu"
	| "branch"
	| "onRefDrop"
	| "onGraphAction"
	| "defaultRemoteName"
	| "setSoloRefs"
	| "soloRefs"
	| "setPinnedRefs"
	| "pinnedRefs"
	| "setHiddenRefs"
>;
export function RefContextMenu({
	refContextMenu,
	onCheckoutRef,
	setRefContextMenu,
	branch,
	onRefDrop,
	onGraphAction,
	defaultRemoteName,
	setSoloRefs,
	soloRefs,
	setPinnedRefs,
	pinnedRefs,
	setHiddenRefs,
}: RefContextMenuProps) {
	return (
		<div
			role="menu"
			aria-label={`Actions for ${refContextMenu.ref.displayName}`}
			{...stylex.props(styles.refContextMenu)}
			style={inlineStyles.getCommitGraphRefContextMenuStyle(
				refContextMenu.x,
				refContextMenu.y,
			)}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div {...stylex.props(styles.refContextTitle)}>
				{refContextMenu.ref.displayName}
			</div>
			{(refContextMenu.ref.kind === "head" ||
				refContextMenu.ref.kind === "localBranch") &&
			refContextMenu.ref.fullName.startsWith("refs/heads/") ? (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						onCheckoutRef?.(refContextMenu.ref.displayName);
						setRefContextMenu(null);
					}}
					{...stylex.props(styles.refContextItem)}
				>
					Checkout {refContextMenu.ref.displayName}
				</button>
			) : null}
			{branch &&
			(refContextMenu.ref.kind === "head" ||
				refContextMenu.ref.kind === "localBranch") &&
			refContextMenu.ref.fullName.startsWith("refs/heads/") &&
			refContextMenu.ref.displayName !== branch ? (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						onRefDrop?.(refContextMenu.ref.displayName, branch);
						setRefContextMenu(null);
					}}
					{...stylex.props(styles.refContextItem)}
				>
					Merge or rebase with {branch}…
				</button>
			) : null}
			{(refContextMenu.ref.kind === "head" ||
				refContextMenu.ref.kind === "localBranch") &&
			refContextMenu.ref.fullName.startsWith("refs/heads/") ? (
				<>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							onGraphAction?.({
								action: "renameBranch",
								target: refContextMenu.ref.displayName,
								itemId: refContextMenu.ref.target,
							});
							setRefContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						Rename branch…
					</button>
					{refContextMenu.ref.kind === "localBranch" ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onGraphAction?.({
									action: "deleteBranch",
									target: refContextMenu.ref.displayName,
									itemId: refContextMenu.ref.target,
								});
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Delete branch…
						</button>
					) : null}
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							onGraphAction?.({
								action: "setUpstream",
								target: refContextMenu.ref.displayName,
								itemId: refContextMenu.ref.target,
								suggestedName: refContextMenu.ref.upstream,
							});
							setRefContextMenu(null);
						}}
						{...stylex.props(styles.refContextItem)}
					>
						Set or change upstream…
					</button>
					{refContextMenu.ref.displayName === branch &&
					!refContextMenu.ref.upstream ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onGraphAction?.({
									action: "pushSetUpstream",
									target: refContextMenu.ref.displayName,
									itemId: refContextMenu.ref.target,
									suggestedName: defaultRemoteName,
								});
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Push and set upstream…
						</button>
					) : null}
					{refContextMenu.ref.displayName === branch &&
					refContextMenu.ref.upstream ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onGraphAction?.({
									action: "forcePushWithLease",
									target: refContextMenu.ref.displayName,
									itemId: refContextMenu.ref.target,
								});
								setRefContextMenu(null);
							}}
							{...stylex.props(styles.refContextItem)}
						>
							Force push with lease…
						</button>
					) : null}
				</>
			) : null}
			{refContextMenu.ref.kind === "remoteBranch" ? (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						onGraphAction?.({
							action: "deleteRemoteBranch",
							target: refContextMenu.ref.fullName,
							itemId: refContextMenu.ref.target,
						});
						setRefContextMenu(null);
					}}
					{...stylex.props(styles.refContextItem)}
				>
					Delete remote branch…
				</button>
			) : null}
			{refContextMenu.ref.kind === "tag"
				? (["pushTag", "deleteRemoteTag", "deleteTag"] as const).map(
						(action) => (
							<button
								key={action}
								type="button"
								role="menuitem"
								onClick={() => {
									onGraphAction?.({
										action,
										target: refContextMenu.ref.displayName,
										itemId: refContextMenu.ref.target,
										suggestedName: defaultRemoteName,
									});
									setRefContextMenu(null);
								}}
								{...stylex.props(styles.refContextItem)}
							>
								{action === "pushTag"
									? "Push tag…"
									: action === "deleteRemoteTag"
										? "Delete remote tag…"
										: "Delete local tag…"}
							</button>
						),
					)
				: null}
			<button
				type="button"
				role="menuitem"
				onClick={() => {
					const fullName = refContextMenu.ref.fullName;
					setSoloRefs((current) =>
						current.includes(fullName)
							? current.filter((value) => value !== fullName)
							: [...current, fullName],
					);
					setRefContextMenu(null);
				}}
				{...stylex.props(styles.refContextItem)}
			>
				{soloRefs.includes(refContextMenu.ref.fullName)
					? "Stop soloing ref"
					: "Solo ref"}
			</button>
			{refContextMenu.ref.kind !== "stash" ? (
				<button
					type="button"
					role="menuitem"
					onClick={() => {
						const fullName = refContextMenu.ref.fullName;
						setPinnedRefs((current) =>
							current.includes(fullName)
								? current.filter((value) => value !== fullName)
								: [...current, fullName],
						);
						setRefContextMenu(null);
					}}
					{...stylex.props(styles.refContextItem)}
				>
					{pinnedRefs.includes(refContextMenu.ref.fullName)
						? "Unpin lane"
						: "Pin lane left"}
				</button>
			) : null}
			<button
				type="button"
				role="menuitem"
				onClick={() => {
					const fullName = refContextMenu.ref.fullName;
					setHiddenRefs((current) =>
						current.includes(fullName) ? current : [...current, fullName],
					);
					setSoloRefs((current) =>
						current.filter((value) => value !== fullName),
					);
					setRefContextMenu(null);
				}}
				{...stylex.props(styles.refContextItem)}
			>
				Hide ref
			</button>
			<button
				type="button"
				role="menuitem"
				onClick={() => {
					void navigator.clipboard.writeText(refContextMenu.ref.fullName);
					setRefContextMenu(null);
				}}
				{...stylex.props(styles.refContextItem)}
			>
				Copy ref name
			</button>
		</div>
	);
}
