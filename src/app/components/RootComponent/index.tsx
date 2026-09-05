import { QueryClientProvider } from "@octanejs/tanstack-query";
import { Outlet } from "@octanejs/tanstack-router";
import { queryClient } from "../../../shared/lib/data.ts";
import { ErrorBoundary } from "../../../shared/ui/ErrorBoundary/index.tsx";
import "../../../design-system/styles.css";
import "virtual:stylex.css";

export function RootComponent() {
	return (
		<QueryClientProvider client={queryClient}>
			<ErrorBoundary>
				<Outlet />
			</ErrorBoundary>
		</QueryClientProvider>
	);
}
