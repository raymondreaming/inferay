import { type Element, Errored, Show } from "solid-js";
import { DiffFallback } from "./DiffFallback.tsx";

export function DiffViewerBoundary(props: {
	children: Element;
	resetKey: string;
}) {
	return (
		<Show when={props.resetKey} keyed>
			<Errored fallback={<DiffFallback />}>{props.children}</Errored>
		</Show>
	);
}
