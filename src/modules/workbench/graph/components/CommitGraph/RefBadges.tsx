import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { GitGraphRef } from "../../../../../../build/presentation/contracts/GitGraphRef.ts";
import type { GitGraphRefKind } from "../../../../../../build/presentation/contracts/GitGraphRefKind.ts";
import { RefBadge } from "./RefBadge.tsx";
import { styles } from "./styles.ts";
export function RefBadges(_props: {
	refs: GitGraphRef[];
	color: string;
	onCheckout?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
}) {
	return (
		<>
			{(() => {
				if (!_props.refs.length) return null;
				const primary = createMemo(() => _props.refs[0]!);
				const primaryLabel = createMemo(() => primary().label);
				const companionRefs = createMemo(() =>
					_props.refs
						.slice(1)
						.filter(
							(ref) =>
								ref.kind === "remoteBranch" &&
								primary().kind !== "remoteBranch" &&
								ref.label === primaryLabel(),
						),
				);
				const companionNames = new Set(
					companionRefs().map((ref) => ref.fullName),
				);
				const overflowRefs = createMemo(() =>
					_props.refs
						.slice(1)
						.filter((ref) => !companionNames.has(ref.fullName)),
				);
				const renderBadge = (
					ref: GitGraphRef,
					trailingKinds?: GitGraphRefKind[],
				) => (
					<RefBadge
						label={ref.label}
						fullName={ref.fullName}
						color={_props.color}
						kind={ref.kind}
						onCheckout={_props.onCheckout}
						onRefDrop={_props.onRefDrop}
						worktreePath={ref.worktreePath}
						upstream={ref.upstream}
						trailingKinds={trailingKinds}
						onOpenContextMenu={(event) =>
							_props.onOpenContextMenu?.(ref, event)
						}
					/>
				);
				return (
					<div {...stylex.attrs(styles.refBadges)}>
						{renderBadge(
							primary(),
							companionRefs().map((ref) => ref.kind),
						)}
						{overflowRefs().length ? (
							<span
								data-ref-overflow={overflowRefs().length}
								title={overflowRefs()
									.map((ref) => ref.displayName)
									.join(", ")}
								{...stylex.attrs(styles.refExtra)}
							>
								+{overflowRefs().length}
							</span>
						) : null}
					</div>
				);
			})()}
		</>
	);
}
