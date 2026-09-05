import * as stylex from "@octanejs/stylex";
import type {
	GitGraphRef,
	GitGraphRefKind,
} from "../../../../repository/hooks/useGitGraph.tsx";
import { refPresentationLabel } from "../../model/graph-model.ts";
import { RefBadge } from "./RefBadge.tsx";
import { styles } from "./styles.ts";

export function RefBadges({
	refs,
	color,
	onCheckout,
	onRefDrop,
	onOpenContextMenu,
}: {
	refs: GitGraphRef[];
	color: string;
	onCheckout?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
}) {
	if (!refs.length) return null;
	const primary = refs[0]!;
	const primaryLabel = refPresentationLabel(primary);
	const companionRefs = refs
		.slice(1)
		.filter(
			(ref) =>
				ref.kind === "remoteBranch" &&
				primary.kind !== "remoteBranch" &&
				refPresentationLabel(ref) === primaryLabel,
		);
	const companionNames = new Set(companionRefs.map((ref) => ref.fullName));
	const overflowRefs = refs
		.slice(1)
		.filter((ref) => !companionNames.has(ref.fullName));
	const renderBadge = (ref: GitGraphRef, trailingKinds?: GitGraphRefKind[]) => (
		<RefBadge
			key={ref.fullName}
			label={refPresentationLabel(ref)}
			fullName={ref.fullName}
			color={color}
			kind={ref.kind}
			onCheckout={onCheckout}
			onRefDrop={onRefDrop}
			worktreePath={ref.worktreePath}
			upstream={ref.upstream}
			trailingKinds={trailingKinds}
			onOpenContextMenu={(event) => onOpenContextMenu?.(ref, event)}
		/>
	);
	return (
		<div {...stylex.props(styles.refBadges)}>
			{renderBadge(
				primary,
				companionRefs.map((ref) => ref.kind),
			)}
			{overflowRefs.length ? (
				<span
					data-ref-overflow={overflowRefs.length}
					title={overflowRefs.map((ref) => ref.displayName).join(", ")}
					{...stylex.props(styles.refExtra)}
				>
					+{overflowRefs.length}
				</span>
			) : null}
		</div>
	);
}
