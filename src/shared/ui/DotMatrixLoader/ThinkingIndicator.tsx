import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { ariaValue } from "../../lib/dom.tsx";
import { DotMatrixRipple } from "./DotMatrixRipple.tsx";
import { styles } from "./styles.ts";
export function ThinkingIndicator(_props: { startTime: number }) {
	const [now, setNow] = createSignal((() => Date.now())());
	onSettled(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	});
	const elapsed = createMemo(() => formatElapsedMs(now() - _props.startTime));
	return (
		<output
			{...stylex.attrs(styles.thinkingRow)}
			aria-live="polite"
			aria-label={ariaValue(`Agent active, ${elapsed()} elapsed`)}
		>
			<DotMatrixRipple />
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
