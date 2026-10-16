import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal } from "solid-js";
import { ariaValue } from "../../lib/dom.tsx";
import { styles } from "./styles.ts";

const DOTS = Array.from({ length: 25 }, (_, index) => {
	const row = Math.floor(index / 5),
		column = index % 5;
	const distance = Math.abs(2 - column),
		ring = Math.abs(2 - row) + distance;
	return {
		peak: column === 1 || column === 3,
		rippleDelay: ring * 0.14 + (ring % 2) * 0.03,
		weaveDelay: -(row * 0.13 + distance * 0.08),
	};
});

export function DotMatrixLoader(props: {
	variant?: "ripple" | "weave";
	dotSize?: number;
	gap?: number;
	speed?: number;
	size?: number;
	ariaLabel?: string;
}) {
	const weave = () => props.variant === "weave";
	return (
		<div
			{...stylex.attrs(styles.matrixGrid, weave() && styles.weaveSlot)}
			style={{
				"--dmx-dot-size": `${props.dotSize ?? 2}px`,
				"--dmx-gap": `${props.gap ?? 1}px`,
				"--dmx-slot-size": `${props.size ?? 15}px`,
				"--dmx-cycle": `${(weave() ? 1600 : 1500) / Math.max(props.speed ?? 1, 0.1)}ms`,
			}}
			role={props.ariaLabel ? "status" : "presentation"}
			aria-label={props.ariaLabel}
			aria-hidden={props.ariaLabel ? undefined : "true"}
		>
			{DOTS.map((dot) => (
				<span
					{...stylex.attrs(
						styles.dot,
						weave() ? styles.weaveDot : styles.rippleDot,
						weave() && (dot.peak ? styles.weaveDotPeak : styles.weaveDotBase),
					)}
					style={{
						"--dmx-delay": weave() ? dot.weaveDelay : dot.rippleDelay,
					}}
				/>
			))}
		</div>
	);
}

export function ThinkingIndicator(_props: {
	startTime: number;
	active?: boolean;
}) {
	const [now, setNow] = createSignal((() => Date.now())());
	createEffect(
		() => _props.active !== false,
		(active) => {
			if (!active) return;
			setNow(Date.now());
			const id = window.setInterval(() => setNow(Date.now()), 1000);
			return () => window.clearInterval(id);
		},
	);
	const elapsed = createMemo(() => formatElapsedMs(now() - _props.startTime));
	return (
		<output
			{...stylex.attrs(styles.thinkingRow)}
			aria-live="polite"
			aria-label={ariaValue(`Agent active, ${elapsed()} elapsed`)}
		>
			<DotMatrixLoader />
			<span {...stylex.attrs(styles.thinkingTime)}>{elapsed()}</span>
		</output>
	);
}
function formatElapsedMs(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 1) return `${seconds}s`;
	const hours = Math.floor(minutes / 60);
	if (hours < 1) return `${minutes}m ${seconds}s`;
	return `${hours}h ${minutes % 60}m`;
}
