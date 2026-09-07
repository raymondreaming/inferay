import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { ariaValue, domStyle } from "../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function DockSplit(_props: {
	direction: "horizontal" | "vertical";
	ratio: number;
	first: Element;
	second: Element;
	onResize: (
		event: PointerEvent & {
			currentTarget: HTMLButtonElement;
		},
	) => void;
}) {
	return (
		<div
			{...stylex.attrs(
				styles.dockSplit,
				_props.direction === "horizontal"
					? styles.dockHorizontal
					: styles.dockVertical,
			)}
		>
			<div
				{...stylex.attrs(styles.dockBranch)}
				style={domStyle(
					inlineStyles.getWorkspaceCanvasDockBranchStyle(_props.ratio),
				)}
			>
				{_props.first}
			</div>
			<button
				type="button"
				aria-label={ariaValue(
					`Resize ${_props.direction === "horizontal" ? "columns" : "rows"}`,
				)}
				onPointerDown={_props.onResize}
				{...stylex.attrs(
					styles.dockDivider,
					_props.direction === "horizontal"
						? styles.dockDividerHorizontal
						: styles.dockDividerVertical,
				)}
			/>
			<div
				{...stylex.attrs(styles.dockBranch)}
				style={domStyle(
					inlineStyles.getWorkspaceCanvasDockBranchStyle1(1 - _props.ratio),
				)}
			>
				{_props.second}
			</div>
		</div>
	);
}
