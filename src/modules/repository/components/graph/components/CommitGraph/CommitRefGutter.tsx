import type { GitGraphRef } from "@contracts";
import { domStyle } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { RefBadge } from "./RefBadge.tsx";
import { RefBadges } from "./RefBadges.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

/** Reference badges and their graph connector for one commit row. */
export function CommitRefGutter(props: {
	width: number;
	color: string;
	commitId: string;
	worktreePath?: string;
	worktreeLabel: string;
	showWipRef: boolean;
	refs: GitGraphRef[];
	ghostRef?: GitGraphRef;
	showGhostRef: boolean;
	onCheckoutRef?: (ref: string) => void;
	onRefDrop?: (source: string, target: string) => void;
	onOpenRefContextMenu?: (ref: GitGraphRef, event: MouseEvent) => void;
}) {
	const hasRefs = () => props.refs.length > 0;
	const hasConnector = () =>
		props.showWipRef || hasRefs() || props.showGhostRef;
	return (
		<div
			{...stylex.attrs(styles.refGutter)}
			style={domStyle(inlineStyles.getCommitRowRefGutterStyle(props.width))}
		>
			{props.showWipRef ? (
				<RefBadge
					label={props.worktreeLabel}
					displayName={props.worktreeLabel}
					fullName={props.commitId}
					color={props.color}
					kind="localBranch"
					worktreePath={props.worktreePath}
				/>
			) : hasRefs() ? (
				<RefBadges
					refs={props.refs}
					color={props.color}
					onCheckout={props.onCheckoutRef}
					onRefDrop={props.onRefDrop}
					onOpenContextMenu={props.onOpenRefContextMenu}
				/>
			) : props.showGhostRef && props.ghostRef ? (
				<RefBadge
					label={props.ghostRef.label}
					displayName={props.ghostRef.displayName}
					fullName={props.ghostRef.fullName}
					color={props.color}
					kind={props.ghostRef.kind}
					onCheckout={props.onCheckoutRef}
					onRefDrop={props.onRefDrop}
					ghost
				/>
			) : null}
			{hasConnector() ? (
				<span
					aria-hidden="true"
					{...stylex.attrs(styles.refConnector)}
					style={domStyle({
						...inlineStyles.getCommitRowRefConnectorStyle(props.color),
						...(props.showWipRef
							? {
									backgroundColor: "transparent",
									backgroundImage: `repeating-linear-gradient(to right, ${props.color} 0 2px, transparent 2px 3px)`,
								}
							: {}),
					})}
				/>
			) : null}
		</div>
	);
}
