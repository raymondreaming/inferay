import { For } from "solid-js";
import type { GraphLines } from "../../../../../../build/presentation/contracts/GraphLines.ts";
import {
	type CSSProperties,
	domStyle,
} from "../../../../../shared/lib/dom.tsx";
export const CommitGraphLinesLayer = function CommitGraphLinesLayer(_props: {
	width: number;
	height: number;
	class?: string;
	style?: CSSProperties;
	lines: GraphLines;
	lineWidth: number;
}) {
	return (
		<svg
			stroke-width={_props.lineWidth}
			stroke-linecap="round"
			aria-hidden="true"
			overflow="hidden"
			class={_props.class}
			width={_props.width}
			height={_props.height}
			style={domStyle(_props.style)}
		>
			{
				<For each={_props.lines.rails} keyed={false}>
					{(segment) => (
						<line
							data-graph-rail="true"
							data-graph-row={segment().row}
							data-graph-column={segment().column}
							x1={segment().x}
							y1={segment().top}
							x2={segment().x}
							y2={segment().bottom}
							stroke={segment().color}
							stroke-opacity={0.98}
						/>
					)}
				</For>
			}
			{
				<For each={_props.lines.transitions} keyed={false}>
					{(curve) => (
						<path
							data-graph-transition="true"
							d={curve().path}
							stroke={curve().color}
							stroke-opacity={0.96}
							stroke-linejoin="round"
							fill="none"
						/>
					)}
				</For>
			}
			{
				<For each={_props.lines.convergences} keyed={false}>
					{(curve) => (
						<path
							data-graph-convergence="true"
							d={curve().path}
							stroke={curve().color}
							stroke-opacity={0.98}
							stroke-linejoin="round"
							fill="none"
						/>
					)}
				</For>
			}
			{
				<For each={_props.lines.truncated} keyed={false}>
					{(segment) => (
						<g>
							<line
								data-graph-truncated="true"
								x1={segment().x}
								y1={segment().top}
								x2={segment().x}
								y2={segment().bottom}
								stroke={segment().color}
								stroke-dasharray="2 3"
							/>
							<circle
								cx={segment().x}
								cy={segment().bottom - 1}
								r={_props.lineWidth}
								fill={segment().color}
							/>
						</g>
					)}
				</For>
			}
		</svg>
	);
};
