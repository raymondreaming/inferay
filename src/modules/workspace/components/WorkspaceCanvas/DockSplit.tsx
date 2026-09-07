import * as stylex from "@octanejs/stylex";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function DockSplit({
	direction,
	ratio,
	first,
	second,
	onResize,
}: {
	direction: "horizontal" | "vertical";
	ratio: number;
	first: unknown;
	second: unknown;
	onResize: (
		event: PointerEvent & { currentTarget: HTMLButtonElement },
	) => void;
}) {
	return (
		<div
			{...stylex.props(
				styles.dockSplit,
				direction === "horizontal"
					? styles.dockHorizontal
					: styles.dockVertical,
			)}
		>
			<div
				{...stylex.props(styles.dockBranch)}
				style={inlineStyles.getWorkspaceCanvasDockBranchStyle(ratio)}
			>
				{first}
			</div>
			<button
				type="button"
				aria-label={`Resize ${direction === "horizontal" ? "columns" : "rows"}`}
				onPointerDown={onResize}
				{...stylex.props(
					styles.dockDivider,
					direction === "horizontal"
						? styles.dockDividerHorizontal
						: styles.dockDividerVertical,
				)}
			/>
			<div
				{...stylex.props(styles.dockBranch)}
				style={inlineStyles.getWorkspaceCanvasDockBranchStyle1(1 - ratio)}
			>
				{second}
			</div>
		</div>
	);
}
