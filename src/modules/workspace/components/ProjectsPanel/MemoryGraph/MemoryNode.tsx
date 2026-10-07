import type { MemoryGraphNode } from "@shared/services/memoryApi.ts";
import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";
import { memoryIconPath } from "../../../model/memoryGraph.ts";
import { projectDocumentUrl } from "../../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export type MemoryDot = {
	node: MemoryGraphNode;
	index: number;
	x: number;
	y: number;
	/** Half height of the tile. */
	r: number;
	w: number;
	active: boolean;
	near: boolean;
	chosen: boolean;
};

/** One memory on the graph: an image thumbnail, or a tile with its kind's icon, plus its name below. */
export function MemoryNode(props: {
	dot: MemoryDot;
	projectId: string;
	zoom: number;
	showLabel: boolean;
	label: string;
	tooltip: string;
	onHover: (id: string | null) => void;
	onPick: (id: string) => void;
}) {
	return (
		<g
			data-memory-node
			{...stylex.attrs(styles.node)}
			transform={`translate(${props.dot.x} ${props.dot.y})`}
			onPointerEnter={() => props.onHover(props.dot.node.id)}
			onPointerLeave={() => props.onHover(null)}
			onPointerDown={(event) => {
				event.stopPropagation();
				props.onPick(props.dot.node.id);
			}}
		>
			<title>{props.tooltip}</title>
			<rect
				x={-props.dot.w / 2 - 8}
				y={-props.dot.r - 8}
				width={props.dot.w + 16}
				height={props.dot.r * 2 + 16}
				fill="transparent"
			/>
			<Show when={props.dot.node.kind === "image"}>
				<clipPath id={`memory-clip-${props.dot.index}`}>
					<rect
						x={-props.dot.w / 2}
						y={-props.dot.r}
						width={props.dot.w}
						height={props.dot.r * 2}
						rx={5}
					/>
				</clipPath>
				<image
					href={projectDocumentUrl(props.projectId, props.dot.node.path)}
					x={-props.dot.w / 2}
					y={-props.dot.r}
					width={props.dot.w}
					height={props.dot.r * 2}
					preserveAspectRatio="xMidYMid slice"
					clip-path={`url(#memory-clip-${props.dot.index})`}
				/>
				<rect
					x={-props.dot.w / 2}
					y={-props.dot.r}
					width={props.dot.w}
					height={props.dot.r * 2}
					rx={5}
					{...stylex.attrs(
						styles.frame,
						props.dot.active && styles.frameActive,
					)}
				/>
			</Show>
			<Show when={props.dot.node.kind !== "image"}>
				<rect
					x={-props.dot.w / 2}
					y={-props.dot.r}
					width={props.dot.w}
					height={props.dot.r * 2}
					rx={props.dot.node.kind === "source" ? props.dot.r : 6}
					{...stylex.attrs(
						styles.tile,
						props.dot.active && styles.tileActive,
						props.dot.node.superseded && styles.tileStale,
					)}
				/>
				<svg
					x={-7}
					y={-7}
					width={14}
					height={14}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					{...stylex.attrs(styles.icon, props.dot.active && styles.iconActive)}
				>
					<path d={memoryIconPath(props.dot.node)} />
				</svg>
			</Show>
			{props.dot.chosen ? (
				<rect
					x={-props.dot.w / 2 - 4}
					y={-props.dot.r - 4}
					width={props.dot.w + 8}
					height={props.dot.r * 2 + 8}
					rx={props.dot.node.kind === "source" ? props.dot.r + 4 : 9}
					{...stylex.attrs(styles.ring)}
				/>
			) : null}
			{props.showLabel ? (
				<text
					x={0}
					y={props.dot.r + 15 / props.zoom}
					text-anchor="middle"
					font-size={String(11.5 / props.zoom)}
					{...stylex.attrs(
						styles.label,
						props.dot.active && styles.labelActive,
					)}
				>
					{props.label}
				</text>
			) : null}
		</g>
	);
}
