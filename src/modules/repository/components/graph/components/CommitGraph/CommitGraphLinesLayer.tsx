import type { GraphLines } from "@contracts";
import { type CSSProperties, domStyle } from "@shared/lib/dom.tsx";
import { For } from "solid-js";
import { GRAPH_DASH_PATTERN, GRAPH_DASH_WIDTH } from "./styles.ts";
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
							stroke-dashoffset={segment().top}
							stroke={segment().color}
							stroke-dasharray={
								segment().dashed ? GRAPH_DASH_PATTERN : undefined
							}
							stroke-width={
								segment().dashed ? GRAPH_DASH_WIDTH : _props.lineWidth
							}
							stroke-linecap="round"
							stroke-opacity={1}
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
							stroke-dasharray={curve().dashed ? GRAPH_DASH_PATTERN : undefined}
							stroke-width={
								curve().dashed ? GRAPH_DASH_WIDTH : _props.lineWidth
							}
							stroke-linecap="round"
							stroke-opacity={1}
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
							stroke-dasharray={curve().dashed ? GRAPH_DASH_PATTERN : undefined}
							stroke-width={
								curve().dashed ? GRAPH_DASH_WIDTH : _props.lineWidth
							}
							stroke-linecap="round"
							stroke-opacity={1}
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
								stroke-dashoffset={segment().top}
								stroke={segment().color}
								stroke-dasharray={GRAPH_DASH_PATTERN}
								stroke-width={GRAPH_DASH_WIDTH}
								stroke-linecap="round"
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
