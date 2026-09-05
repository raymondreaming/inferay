import { ErrorBoundary } from "octane";
import { ChatPaneRecovery } from "./ChatPaneRecovery.tsx";

function renderChatPaneRecovery(error: unknown, reset: () => void) {
	return <ChatPaneRecovery error={error} reset={reset} />;
}

export function ChatPaneBoundary({ children }: { children: unknown }) {
	return (
		<ErrorBoundary fallback={renderChatPaneRecovery}>{children}</ErrorBoundary>
	);
}
