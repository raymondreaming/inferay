import { QueryClientProvider } from "@tanstack/solid-query";
import { Loading } from "solid-js";
import { Router } from "../../../router.tsx";
import { queryClient } from "../../../shared/lib/dom.tsx";
import { ErrorBoundary } from "../../../shared/ui/ErrorBoundary/index.tsx";
import "../../../design-system/styles.css";
export function RootComponent() {
	return (
		<QueryClientProvider client={queryClient}>
			<ErrorBoundary>
				<Loading fallback={<div role="status">Loading Inferay…</div>}>
					<Router />
				</Loading>
			</ErrorBoundary>
		</QueryClientProvider>
	);
}
