import * as stylex from "@stylexjs/stylex";
import { createEffect } from "solid-js";
import { Button } from "../Button/index.tsx";
import { styles } from "./styles.ts";
export function RecoveryFallback(_props: {
	error: unknown;
	reset: () => void;
	label: string;
	contained?: boolean;
}) {
	createEffect(
		() => _props.error,
		(error) => {
			console.error("[renderer] Render error:", error);
		},
	);
	return (
		<div
			role="alert"
			{...stylex.attrs(styles.fallback, _props.contained && styles.contained)}
		>
			<p {...stylex.attrs(styles.message)}>
				{_props.label} couldn’t be displayed.
			</p>
			<Button liquid={false} variant="secondary" onClick={_props.reset}>
				Retry {_props.label.toLowerCase()}
			</Button>
		</div>
	);
}
