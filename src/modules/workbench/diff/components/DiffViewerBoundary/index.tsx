import { ErrorBoundary } from "octane";
import { DiffFallback } from "./DiffFallback.tsx";

interface DiffViewerBoundaryProps {
	children: unknown;
	resetKey: string;
}

export function DiffViewerBoundary({
	children,
	resetKey,
}: DiffViewerBoundaryProps) {
	return (
		<ErrorBoundary key={resetKey} fallback={<DiffFallback />}>
			{children}
		</ErrorBoundary>
	);
}
