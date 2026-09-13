import { type Element, Errored } from "solid-js";
import { RecoveryFallback } from "./RecoveryFallback.tsx";
export function ErrorBoundary(props: {
	children: Element;
	label?: string;
	contained?: boolean;
}) {
	return (
		<Errored
			fallback={(error, reset) => (
				<RecoveryFallback
					error={error()}
					reset={reset}
					label={props.label ?? "Workspace"}
					contained={props.contained}
				/>
			)}
		>
			{props.children}
		</Errored>
	);
}
