import type { GraphLines } from "@contracts";
import { type CSSProperties, domStyle } from "@shared/lib/dom.tsx";
import { For } from "solid-js";
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
							stroke-dasharray={segment().dashed ? "2 1" : undefined}
							stroke-linecap={segment().dashed ? "butt" : "round"}
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
							stroke-dasharray={curve().dashed ? "2 1" : undefined}
							stroke-linecap={curve().dashed ? "butt" : "round"}
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
							stroke-dasharray={curve().dashed ? "2 1" : undefined}
							stroke-linecap={curve().dashed ? "butt" : "round"}
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
								stroke-dasharray="2 1"
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
