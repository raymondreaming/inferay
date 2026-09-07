import { createMemo } from "solid-js";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu.tsx";
import type {
	GitGraphActionRequest,
	useCommitGraphState,
} from "./useCommitGraphState.tsx";

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
export function RefContextMenu(_props: RefContextMenuProps) {
	const ref = createMemo(() => _props.refContextMenu.ref);
	const entries = createMemo(() => {
		const entries: ContextMenuEntry[] = [];
		const add = (label: string, run: () => void) =>
			entries.push({
				label,
				run,
			});
		const action = (
			label: string,
			action: GitGraphActionRequest["action"],
			extra: Partial<GitGraphActionRequest> = {},
		) =>
			add(label, () => {
				const _refValue = ref();
				return _props.onGraphAction?.({
					action,
					target: _refValue.displayName,
					itemId: _refValue.target,
					...extra,
				});
			});
		const local = createMemo(() => {
			const _refValue2 = ref();
			return (
				(_refValue2.kind === "head" || _refValue2.kind === "localBranch") &&
				_refValue2.fullName.startsWith("refs/heads/")
			);
		});
		if (local()) {
			add(`Checkout ${ref().displayName}`, () =>
				_props.onCheckoutRef?.(ref().displayName),
			);
			if (_props.branch && ref().displayName !== _props.branch)
				add(
					`Merge or rebase with ${_props.branch}…`,
					() =>
						_props.branch &&
						_props.onRefDrop?.(ref().displayName, _props.branch),
				);
			action("Rename branch…", "renameBranch");
			if (ref().kind === "localBranch")
				action("Delete branch…", "deleteBranch");
			action("Set or change upstream…", "setUpstream", {
				suggestedName: ref().upstream,
			});
			if (ref().displayName === _props.branch) {
				if (ref().upstream)
					action("Force push with lease…", "forcePushWithLease");
				else
					action("Push and set upstream…", "pushSetUpstream", {
						suggestedName: _props.defaultRemoteName,
					});
			}
		}
		if (ref().kind === "remoteBranch")
			action("Delete remote branch…", "deleteRemoteBranch", {
				target: ref().fullName,
			});
		if (ref().kind === "tag") {
			for (const [label, name] of [
				["Push tag…", "pushTag"],
				["Delete remote tag…", "deleteRemoteTag"],
				["Delete local tag…", "deleteTag"],
			] as const)
				action(label, name, {
					suggestedName: _props.defaultRemoteName,
				});
		}
		const toggle = (current: string[]) => {
			const _refValue3 = ref();
			return current.includes(_refValue3.fullName)
				? current.filter((value) => value !== ref().fullName)
				: [...current, _refValue3.fullName];
		};
		add(
			_props.soloRefs.includes(ref().fullName)
				? "Stop soloing ref"
				: "Solo ref",
			() => _props.setSoloRefs(toggle),
		);
		if (ref().kind !== "stash")
			add(
				_props.pinnedRefs.includes(ref().fullName)
					? "Unpin lane"
					: "Pin lane left",
				() => _props.setPinnedRefs(toggle),
			);
		add("Hide ref", () => {
			_props.setHiddenRefs((current) => {
				const _refValue4 = ref();
				return current.includes(_refValue4.fullName)
					? current
					: [...current, _refValue4.fullName];
			});
			_props.setSoloRefs((current) =>
				current.filter((value) => value !== ref().fullName),
			);
		});
		add("Copy ref name", () => {
			void navigator.clipboard.writeText(ref().fullName);
		});
		return entries;
	});
	return (
		<ContextMenu
			x={_props.refContextMenu.x}
			y={_props.refContextMenu.y}
			title={ref().displayName}
			entries={entries()}
			onClose={() => _props.setRefContextMenu(null)}
		/>
	);
}
