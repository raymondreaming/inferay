import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import {
	MEMORY_CATEGORIES,
	type MemoryCategory,
} from "../../../model/memoryGraph.ts";
import { styles } from "./styles.ts";

const Stroke = (props: { d: string }) => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d={props.d} />
	</svg>
);

export function GraphFilters(props: {
	query: string;
	onQuery: (value: string) => void;
	onOpenFirst: () => void;
	category: MemoryCategory;
	counts: Record<MemoryCategory, number>;
	onCategory: (value: MemoryCategory) => void;
	truncated: boolean;
}) {
	return (
		<div
			data-memory-controls
			role="group"
			aria-label="Show"
			{...stylex.attrs(styles.filters)}
		>
			<label {...stylex.attrs(styles.search)}>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				>
					<circle cx="11" cy="11" r="7" />
					<path d="M20 20l-3.5-3.5" />
				</svg>
				<input
					aria-label="Search memory"
					placeholder="Search memory"
					value={props.query}
					onInput={(event) => props.onQuery(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") props.onQuery("");
						if (event.key === "Enter") props.onOpenFirst();
					}}
					{...stylex.attrs(styles.searchInput)}
				/>
			</label>
			<For
				each={MEMORY_CATEGORIES.filter(
					(c) => c.id === "all" || props.counts[c.id] > 0,
				)}
			>
				{(c) => (
					<button
						type="button"
						aria-pressed={props.category === c.id ? "true" : "false"}
						{...stylex.attrs(
							styles.filter,
							props.category === c.id && styles.filterOn,
						)}
						onClick={() => props.onCategory(c.id)}
					>
						{c.label}
						<span {...stylex.attrs(styles.filterCount)}>
							{props.counts[c.id]}
						</span>
					</button>
				)}
			</For>
			{props.truncated ? (
				<span {...stylex.attrs(styles.filterCount)}>newest shown</span>
			) : null}
		</div>
	);
}

export function ZoomControls(props: {
	zoom: number;
	onZoom: (factor: number) => void;
	onReset: () => void;
	onFit: () => void;
}) {
	return (
		<div
			data-memory-controls
			role="toolbar"
			aria-label="Zoom"
			{...stylex.attrs(styles.controls)}
		>
			<button
				type="button"
				aria-label="Zoom in"
				{...stylex.attrs(styles.control)}
				onClick={() => props.onZoom(1.4)}
			>
				<Stroke d="M12 5v14M5 12h14" />
			</button>
			<button
				type="button"
				aria-label="Reset zoom to 100%"
				{...stylex.attrs(styles.control, styles.zoomValue)}
				onClick={() => props.onReset()}
			>
				{Math.round(props.zoom * 100)}%
			</button>
			<button
				type="button"
				aria-label="Zoom out"
				{...stylex.attrs(styles.control)}
				onClick={() => props.onZoom(1 / 1.4)}
			>
				<Stroke d="M5 12h14" />
			</button>
			<span {...stylex.attrs(styles.controlDivider)} />
			<button
				type="button"
				aria-label="Fit to screen"
				{...stylex.attrs(styles.control)}
				onClick={() => props.onFit()}
			>
				<Stroke d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
			</button>
		</div>
	);
}
