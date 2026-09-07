import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import type { MinimapSegment } from "../../../../../../build/presentation/contracts/MinimapSegment.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { diffStyles } from "./styles.ts";
export function DiffMinimap(props: {
	rowCount: number;
	segments: MinimapSegment[];
	scrollTop: number;
	viewHeight: number;
	totalHeight: number;
	onScrollTo: (lineIndex: number) => void;
}) {
	let rail: HTMLButtonElement | undefined;
	let frame = 0;
	let pointer: number | undefined;
	let grabOffset = 0;
	let nextTop = 0;
	const [hovered, setHovered] = createSignal(false);
	const [dragging, setDragging] = createSignal(false);
	const enabled = createMemo(
		() => props.rowCount > 0 && props.totalHeight > props.viewHeight,
	);
	const ratio = createMemo(() =>
		Math.min(1, props.viewHeight / Math.max(1, props.totalHeight)),
	);
	const topRatio = createMemo(() =>
		Math.max(
			0,
			Math.min(
				1,
				props.scrollTop / Math.max(1, props.totalHeight - props.viewHeight),
			),
		),
	);
	const jump = (top: number) =>
		props.onScrollTo(
			(Math.max(0, Math.min(props.totalHeight - props.viewHeight, top)) +
				props.viewHeight / 2) /
				(props.totalHeight / props.rowCount),
		);
	const flush = () => {
		frame = 0;
		jump(nextTop);
	};
	const move = (event: PointerEvent) => {
		if (!rail || pointer !== event.pointerId) return;
		const rect = rail.getBoundingClientRect();
		const thumb = Math.min(rect.height, Math.max(16, ratio() * rect.height));
		nextTop =
			((event.clientY - rect.top - grabOffset) /
				Math.max(1, rect.height - thumb)) *
			(props.totalHeight - props.viewHeight);
		if (!frame) frame = requestAnimationFrame(flush);
	};
	const release = (event: PointerEvent) => {
		if (pointer !== event.pointerId) return;
		if (frame) {
			cancelAnimationFrame(frame);
			flush();
		}
		pointer = undefined;
		setDragging(false);
		if (rail?.hasPointerCapture(event.pointerId))
			rail.releasePointerCapture(event.pointerId);
	};
	onSettled(() => () => cancelAnimationFrame(frame));
	return (
		<button
			type="button"
			ref={(element) => {
				rail = element;
			}}
			aria-label="Scroll diff overview"
			disabled={!enabled()}
			data-diff-minimap
			{...stylex.attrs(
				diffStyles.minimap,
				diffStyles.minimapInteractive,
				(hovered() || dragging()) && diffStyles.minimapExpanded,
			)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onPointerDown={(event) => {
				if (event.button !== 0 || !event.isPrimary || !rail || !enabled())
					return;
				event.preventDefault();
				rail.focus();
				pointer = event.pointerId;
				const rect = rail.getBoundingClientRect();
				const thumb = Math.min(
					rect.height,
					Math.max(16, ratio() * rect.height),
				);
				const top =
					(props.scrollTop /
						Math.max(1, props.totalHeight - props.viewHeight)) *
					(rect.height - thumb);
				const y = event.clientY - rect.top;
				grabOffset = y >= top && y <= top + thumb ? y - top : thumb / 2;
				setDragging(true);
				rail.setPointerCapture(event.pointerId);
				move(event);
			}}
			onPointerMove={move}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			onKeyDown={(event) => {
				const step = props.totalHeight / props.rowCount;
				const targets: Record<string, number> = {
					ArrowUp: props.scrollTop - step,
					ArrowDown: props.scrollTop + step,
					PageUp: props.scrollTop - props.viewHeight,
					PageDown: props.scrollTop + props.viewHeight,
					Home: 0,
					End: props.totalHeight,
					Enter: props.totalHeight / 2,
					" ": props.scrollTop + props.viewHeight,
				};
				if (event.key in targets) {
					event.preventDefault();
					jump(targets[event.key]!);
				}
			}}
		>
			<For each={props.segments} keyed={false}>
				{(seg) => (
					<div
						data-diff-minimap-change={`${seg().side}:${seg().type}`}
						{...stylex.attrs(
							diffStyles.minimapSegment,
							seg().type === "add"
								? diffStyles.minimapAdd
								: diffStyles.minimapDelete,
						)}
						style={domStyle(
							inlineStyles.getDiffMinimapMinimapSegmentStyle(
								seg().side === "left" || seg().side === "full" ? 8 : undefined,
								seg().side === "right" || seg().side === "full" ? 0 : undefined,
								seg().side === "full" ? "auto" : undefined,
								`${(seg().startLine / props.rowCount) * 100}%`,
								`max(2px, ${((seg().endLine - seg().startLine) / props.rowCount) * 100}%)`,
							),
						)}
					/>
				)}
			</For>
			<div
				data-diff-minimap-thumb
				{...stylex.attrs(
					diffStyles.minimapThumb,
					(hovered() || dragging()) && diffStyles.minimapThumbExpanded,
				)}
				style={domStyle(
					inlineStyles.getDiffMinimapMinimapThumbStyle(
						`calc(${topRatio() * 100}% - max(${topRatio() * 16}px, ${topRatio() * ratio() * 100}%))`,
						`${ratio() * 100}%`,
					),
				)}
			/>
		</button>
	);
}
