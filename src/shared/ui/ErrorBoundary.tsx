import * as stylex from "@octanejs/stylex";
import { ErrorBoundary as OctaneErrorBoundary, useEffect } from "octane";
import { color, font } from "../../design-system/styles.stylex.ts";

function RecoveryFallback({
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

function renderRecoveryFallback(error: unknown, reset: () => void) {
	return <RecoveryFallback error={error} reset={reset} />;
}

export function ErrorBoundary({ children }: { children: unknown }) {
	return (
		<OctaneErrorBoundary fallback={renderRecoveryFallback}>
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
