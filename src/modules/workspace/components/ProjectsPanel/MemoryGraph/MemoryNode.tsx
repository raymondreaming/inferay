import type { MemoryGraphNode } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Show } from "solid-js";
import { type GraphPoint, memoryIconPath } from "../../../model/memoryGraph.ts";
import { projectDocumentUrl } from "../../../services/projectsApi.ts";
import { styles } from "./styles.ts";

export function MemoryNode(props: {
	node: MemoryGraphNode;
	index: number;
	point: GraphPoint | undefined;
	degree: number;
	active: boolean;
	chosen: boolean;
	projectId: string;
	zoom: number;
	showLabel: boolean;
	label: string;
	tooltip: string;
	onHover: (id: string | null) => void;
	onPick: (id: string) => void;
}) {
	const r = createMemo(() =>
		props.node.kind === "source"
			? 16 + Math.min(4, Math.sqrt(props.degree))
			: props.node.kind === "image"
				? 15
				: 12,
	);
	const w = () => (props.node.kind === "image" ? 40 : r() * 2);
	return (
		<g
			data-memory-node
			{...stylex.attrs(styles.node)}
			transform={`translate(${props.point?.x ?? 0} ${props.point?.y ?? 0})`}
			onPointerEnter={() => props.onHover(props.node.id)}
			onPointerLeave={() => props.onHover(null)}
			onPointerDown={(event) => {
				event.stopPropagation();
				props.onPick(props.node.id);
			}}
		>
			<title>{props.tooltip}</title>
			<rect
				x={-w() / 2 - 8}
				y={-r() - 8}
				width={w() + 16}
				height={r() * 2 + 16}
				fill="transparent"
			/>
			<Show when={props.node.kind === "image"}>
				<clipPath id={`memory-clip-${props.index}`}>
					<rect x={-w() / 2} y={-r()} width={w()} height={r() * 2} rx={5} />
				</clipPath>
				<image
					href={projectDocumentUrl(props.projectId, props.node.path)}
					x={-w() / 2}
					y={-r()}
					width={w()}
					height={r() * 2}
					preserveAspectRatio="xMidYMid slice"
					clip-path={`url(#memory-clip-${props.index})`}
				/>
				<rect
					x={-w() / 2}
					y={-r()}
					width={w()}
					height={r() * 2}
					rx={5}
					{...stylex.attrs(styles.frame, props.active && styles.frameActive)}
				/>
			</Show>
			<Show when={props.node.kind !== "image"}>
				<rect
					x={-w() / 2}
					y={-r()}
					width={w()}
					height={r() * 2}
					rx={props.node.kind === "source" ? r() : 6}
					{...stylex.attrs(
						styles.tile,
						props.active && styles.tileActive,
						props.node.superseded && styles.tileStale,
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
					{...stylex.attrs(styles.icon, props.active && styles.iconActive)}
				>
					<path d={memoryIconPath(props.node)} />
				</svg>
			</Show>
			{props.chosen ? (
				<rect
					x={-w() / 2 - 4}
					y={-r() - 4}
					width={w() + 8}
					height={r() * 2 + 8}
					rx={props.node.kind === "source" ? r() + 4 : 9}
					{...stylex.attrs(styles.ring)}
				/>
			) : null}
			{props.showLabel ? (
				<text
					x={0}
					y={r() + 15 / props.zoom}
					text-anchor="middle"
					font-size={String(11.5 / props.zoom)}
					{...stylex.attrs(styles.label, props.active && styles.labelActive)}
				>
					{props.label}
				</text>
			) : null}
		</g>
	);
}
