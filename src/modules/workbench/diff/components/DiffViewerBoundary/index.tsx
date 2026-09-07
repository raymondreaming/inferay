import { type Element, Errored, Show } from "solid-js";
import { DiffFallback } from "./DiffFallback.tsx";

interface DiffViewerBoundaryProps {
	children: Element;
	resetKey: string;
}
export function DiffViewerBoundary(props: DiffViewerBoundaryProps) {
	return (
		<Show when={props.resetKey} keyed>
			<Errored fallback={<DiffFallback />}>{props.children}</Errored>
		</Show>
	);
}
