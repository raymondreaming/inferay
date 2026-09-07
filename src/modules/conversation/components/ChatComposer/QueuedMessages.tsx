import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
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
export function QueuedMessages(_props: QueuedMessagesProps) {
	return (
		<div {...stylex.attrs(styles.queueList)}>
			{
				<For each={_props.queuedMessages} keyed={(row) => row.id}>
					{(qm, idx) => (
						<QueuedMessageRow
							index={idx()}
							message={qm()}
							isEditing={_props.editingQueueId === qm().id}
							editingQueueText={_props.editingQueueText}
							setEditingQueueText={_props.setEditingQueueText}
							startQueuedMessageEdit={_props.startQueuedMessageEdit}
							cancelQueuedMessageEdit={_props.cancelQueuedMessageEdit}
							saveQueuedMessageEdit={_props.saveQueuedMessageEdit}
							removeQueuedMessage={_props.removeQueuedMessage}
						/>
					)}
				</For>
			}
		</div>
	);
}
