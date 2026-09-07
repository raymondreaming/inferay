import { type Element, Errored } from "solid-js";
import { RecoveryFallback } from "./RecoveryFallback.tsx";
export function ErrorBoundary(props: { children: Element }) {
	return (
		<Errored
			fallback={(error, reset) => (
				<RecoveryFallback error={error()} reset={reset} />
			)}
		>
			{props.children}
		</Errored>
	);
}
