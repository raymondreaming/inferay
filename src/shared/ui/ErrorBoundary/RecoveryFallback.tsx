import * as stylex from "@stylexjs/stylex";
import { createEffect } from "solid-js";
import { styles } from "./styles.ts";
export function RecoveryFallback(_props: {
	error: unknown;
	reset: () => void;
}) {
	createEffect(
		() => [_props.error, _props.reset] as const,
		([error, reset]) => {
			console.error("[renderer] Recovered from an app render error:", error);
			const timer = window.setTimeout(reset, 1500);
			return () => window.clearTimeout(timer);
		},
	);
	return (
		<div {...stylex.attrs(styles.fallback)}>
			<p {...stylex.attrs(styles.message)}>Recovering the workspace…</p>
		</div>
	);
}
