import { queryClient } from "@shared/lib/dom.tsx";
import { ErrorBoundary } from "@shared/ui/ErrorBoundary/index.tsx";
import { QueryClientProvider } from "@tanstack/solid-query";
import { createSignal, Loading, lazy, onSettled } from "solid-js";
import { AppLayout } from "../AppLayout/index.tsx";
import "@design-system/styles.css";

const AgentPage = lazy(() =>
	import("@workspace/components/AgentPage/index.tsx").then((module) => ({
		default: module.AgentPage,
	})),
);
const PerformanceRecorder = lazy(
	() => import("../PerformanceRecorder/index.tsx"),
);
export function RootComponent() {
	const [recording, setRecording] = createSignal(false);
	onSettled(() => {
		const toggle = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				event.altKey &&
				event.code === "KeyP"
			) {
				event.preventDefault();
				setRecording((current) => !current);
			}
		};
		window.addEventListener("keydown", toggle);
		return () => window.removeEventListener("keydown", toggle);
	});
	return (
		<QueryClientProvider client={queryClient}>
			<ErrorBoundary>
				<Loading fallback={<div role="status">Loading Inferay…</div>}>
					<AppLayout>
						<AgentPage />
					</AppLayout>
					{recording() && (
						<Loading fallback={null}>
							<PerformanceRecorder onClose={() => setRecording(false)} />
						</Loading>
					)}
				</Loading>
			</ErrorBoundary>
		</QueryClientProvider>
	);
}
