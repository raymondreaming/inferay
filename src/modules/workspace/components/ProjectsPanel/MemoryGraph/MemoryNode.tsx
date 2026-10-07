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
	const d = () => props.dot;
	return (
		<g
			data-memory-node
			{...stylex.attrs(styles.node)}
			transform={`translate(${d().x} ${d().y})`}
			onPointerEnter={() => props.onHover(d().node.id)}
			onPointerLeave={() => props.onHover(null)}
			onPointerDown={(event) => {
				event.stopPropagation();
				props.onPick(d().node.id);
			}}
		>
			<title>{props.tooltip}</title>
			<rect
				x={-d().w / 2 - 8}
				y={-d().r - 8}
				width={d().w + 16}
				height={d().r * 2 + 16}
				fill="transparent"
			/>
			<Show when={d().node.kind === "image"}>
				<clipPath id={`memory-clip-${d().index}`}>
					<rect
						x={-d().w / 2}
						y={-d().r}
						width={d().w}
						height={d().r * 2}
						rx={5}
					/>
				</clipPath>
				<image
					href={projectDocumentUrl(props.projectId, d().node.path)}
					x={-d().w / 2}
					y={-d().r}
					width={d().w}
					height={d().r * 2}
					preserveAspectRatio="xMidYMid slice"
					clip-path={`url(#memory-clip-${d().index})`}
				/>
				<rect
					x={-d().w / 2}
					y={-d().r}
					width={d().w}
					height={d().r * 2}
					rx={5}
					{...stylex.attrs(styles.frame, d().active && styles.frameActive)}
				/>
			</Show>
			<Show when={d().node.kind !== "image"}>
				<rect
					x={-d().w / 2}
					y={-d().r}
					width={d().w}
					height={d().r * 2}
					rx={d().node.kind === "source" ? d().r : 6}
					{...stylex.attrs(
						styles.tile,
						d().active && styles.tileActive,
						d().node.superseded && styles.tileStale,
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
					{...stylex.attrs(styles.icon, d().active && styles.iconActive)}
				>
					<path d={memoryIconPath(d().node)} />
				</svg>
			</Show>
			{d().chosen ? (
				<rect
					x={-d().w / 2 - 4}
					y={-d().r - 4}
					width={d().w + 8}
					height={d().r * 2 + 8}
					rx={d().node.kind === "source" ? d().r + 4 : 9}
					{...stylex.attrs(styles.ring)}
				/>
			) : null}
			{props.showLabel ? (
				<text
					x={0}
					y={d().r + 15 / props.zoom}
					text-anchor="middle"
					font-size={String(11.5 / props.zoom)}
					{...stylex.attrs(styles.label, d().active && styles.labelActive)}
				>
					{props.label}
				</text>
			) : null}
		</g>
	);
}
