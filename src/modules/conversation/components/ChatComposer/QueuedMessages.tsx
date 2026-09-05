import * as stylex from "@octanejs/stylex";
import { QueuedMessageRow } from "./QueuedMessageRow.tsx";

import { styles } from "./styles.ts";
import type { useChatComposerState } from "./useChatComposerState.tsx";

type QueuedMessagesProps = Pick<
	ReturnType<typeof useChatComposerState>,
	| "queuedMessages"
	| "editingQueueId"
	| "editingQueueText"
	| "setEditingQueueText"
	| "startQueuedMessageEdit"
	| "cancelQueuedMessageEdit"
	| "saveQueuedMessageEdit"
	| "removeQueuedMessage"
>;
export function QueuedMessages({
	queuedMessages,
	editingQueueId,
	editingQueueText,
	setEditingQueueText,
	startQueuedMessageEdit,
	cancelQueuedMessageEdit,
	saveQueuedMessageEdit,
	removeQueuedMessage,
}: QueuedMessagesProps) {
	return (
		<div {...stylex.props(styles.queueList)}>
			{queuedMessages.map((qm, idx) => (
				<QueuedMessageRow
					key={qm.id}
					index={idx}
					message={qm}
					isEditing={editingQueueId === qm.id}
					editingQueueText={editingQueueText}
					setEditingQueueText={setEditingQueueText}
					startQueuedMessageEdit={startQueuedMessageEdit}
					cancelQueuedMessageEdit={cancelQueuedMessageEdit}
					saveQueuedMessageEdit={saveQueuedMessageEdit}
					removeQueuedMessage={removeQueuedMessage}
				/>
			))}
		</div>
	);
}
