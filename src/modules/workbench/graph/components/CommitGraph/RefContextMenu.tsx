import { ContextMenu, type ContextMenuEntry } from "./ContextMenu.tsx";
import type { GitGraphActionRequest } from "./graph-preferences.ts";
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
	const ref = refContextMenu.ref;
	const entries: ContextMenuEntry[] = [];
	const add = (label: string, run: () => void) => entries.push({ label, run });
	const action = (
		label: string,
		action: GitGraphActionRequest["action"],
		extra: Partial<GitGraphActionRequest> = {},
	) =>
		add(label, () =>
			onGraphAction?.({
				action,
				target: ref.displayName,
				itemId: ref.target,
				...extra,
			}),
		);
	const local =
		(ref.kind === "head" || ref.kind === "localBranch") &&
		ref.fullName.startsWith("refs/heads/");
	if (local) {
		add(`Checkout ${ref.displayName}`, () => onCheckoutRef?.(ref.displayName));
		if (branch && ref.displayName !== branch)
			add(`Merge or rebase with ${branch}…`, () =>
				onRefDrop?.(ref.displayName, branch),
			);
		action("Rename branch…", "renameBranch");
		if (ref.kind === "localBranch") action("Delete branch…", "deleteBranch");
		action("Set or change upstream…", "setUpstream", {
			suggestedName: ref.upstream,
		});
		if (ref.displayName === branch) {
			if (ref.upstream) action("Force push with lease…", "forcePushWithLease");
			else
				action("Push and set upstream…", "pushSetUpstream", {
					suggestedName: defaultRemoteName,
				});
		}
	}
	if (ref.kind === "remoteBranch")
		action("Delete remote branch…", "deleteRemoteBranch", {
			target: ref.fullName,
		});
	if (ref.kind === "tag") {
		for (const [label, name] of [
			["Push tag…", "pushTag"],
			["Delete remote tag…", "deleteRemoteTag"],
			["Delete local tag…", "deleteTag"],
		] as const)
			action(label, name, { suggestedName: defaultRemoteName });
	}
	const toggle = (current: string[]) =>
		current.includes(ref.fullName)
			? current.filter((value) => value !== ref.fullName)
			: [...current, ref.fullName];
	add(soloRefs.includes(ref.fullName) ? "Stop soloing ref" : "Solo ref", () =>
		setSoloRefs(toggle),
	);
	if (ref.kind !== "stash")
		add(
			pinnedRefs.includes(ref.fullName) ? "Unpin lane" : "Pin lane left",
			() => setPinnedRefs(toggle),
		);
	add("Hide ref", () => {
		setHiddenRefs((current) =>
			current.includes(ref.fullName) ? current : [...current, ref.fullName],
		);
		setSoloRefs((current) => current.filter((value) => value !== ref.fullName));
	});
	add("Copy ref name", () => {
		void navigator.clipboard.writeText(ref.fullName);
	});
	return (
		<ContextMenu
			x={refContextMenu.x}
			y={refContextMenu.y}
			title={ref.displayName}
			entries={entries}
			onClose={() => setRefContextMenu(null)}
		/>
	);
}
