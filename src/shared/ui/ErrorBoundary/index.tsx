import { ErrorBoundary as OctaneErrorBoundary } from "octane";
import { RecoveryFallback } from "./RecoveryFallback.tsx";

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
