import { type Element, Errored } from "solid-js";
import { ChatPaneRecovery } from "./ChatPaneRecovery.tsx";
export function ChatPaneBoundary(props: { children: Element }) {
	return (
		<Errored
			fallback={(error, reset) => (
				<ChatPaneRecovery error={error()} reset={reset} />
			)}
		>
			{props.children}
		</Errored>
	);
}
