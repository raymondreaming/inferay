import * as stylex from "@octanejs/stylex";
import { ErrorBoundary as OctaneErrorBoundary, useEffect } from "octane";
import { color, font } from "../../tokens.stylex.ts";

function ReconnectingFallback({ reset }: { reset: () => void }) {
	useEffect(() => {
		const timer = window.setTimeout(reset, 1500);
		return () => window.clearTimeout(timer);
	}, [reset]);

	return (
		<div {...stylex.props(styles.fallback)}>
			<p {...stylex.props(styles.message)}>Reconnecting…</p>
		</div>
	);
}

function renderReconnectingFallback(_error: unknown, reset: () => void) {
	return <ReconnectingFallback reset={reset} />;
}

export function ErrorBoundary({ children }: { children: unknown }) {
	return (
		<OctaneErrorBoundary fallback={renderReconnectingFallback}>
			{children}
		</OctaneErrorBoundary>
	);
}

const styles = stylex.create({
	fallback: {
		alignItems: "center",
		backgroundColor: color.background,
		display: "flex",
		height: "100vh",
		justifyContent: "center",
	},
	message: {
		color: color.textSoft,
		fontSize: font.size_3,
	},
});
