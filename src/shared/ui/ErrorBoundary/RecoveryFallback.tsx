import * as stylex from "@octanejs/stylex";
import { useEffect } from "octane";
import { styles } from "./styles.ts";

export function RecoveryFallback({
	error,
	reset,
}: {
	error: unknown;
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[renderer] Recovered from an app render error:", error);
		const timer = window.setTimeout(reset, 1500);
		return () => window.clearTimeout(timer);
	}, [error, reset]);

	return (
		<div {...stylex.props(styles.fallback)}>
			<p {...stylex.props(styles.message)}>Recovering the workspace…</p>
		</div>
	);
}
