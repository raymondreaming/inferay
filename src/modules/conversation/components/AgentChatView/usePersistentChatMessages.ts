import { useEffect, useMemo, useSyncExternalStore } from "octane";
import { dispatchAgentShellChange } from "../../../workspace/model/workspace-model.ts";
import { getChatMessageReadModel } from "../../model/chat-session-store.ts";

export function usePersistentChatMessages(paneId: string) {
	const messageReadModel = useMemo(
		() => getChatMessageReadModel(paneId),
		[paneId],
	);
	const messages = useSyncExternalStore(
		messageReadModel.subscribe,
		messageReadModel.getSnapshot,
		messageReadModel.getSnapshot,
	);

	useEffect(() => {
		messageReadModel.setSummaryChangeCallback(() => {
			dispatchAgentShellChange({
				source: "cache",
				reason: "session-title",
			});
		});
		return () => {
			messageReadModel.setSummaryChangeCallback(() => {});
		};
	}, [messageReadModel]);
	return {
		messageReadModel,
		messages,
		setMessages: messageReadModel.set,
	};
}
