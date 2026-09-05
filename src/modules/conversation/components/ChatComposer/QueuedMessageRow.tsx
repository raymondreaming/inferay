import * as stylex from "@octanejs/stylex";
import { memo, useEffect, useRef } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { setInputValue } from "../../../../shared/lib/react-events.ts";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconCheck,
	IconPencil,
	IconTrash,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import type { QueuedMessageInfo } from "../../model/agent-chat-shared.ts";
import { styles } from "./styles.ts";

export const QueuedMessageRow = memo(function QueuedMessageRow({
	index,
	message,
	isEditing,
	editingQueueText,
	setEditingQueueText,
	startQueuedMessageEdit,
	cancelQueuedMessageEdit,
	saveQueuedMessageEdit,
	removeQueuedMessage,
}: {
	index: number;
	message: QueuedMessageInfo;
	isEditing: boolean;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	startQueuedMessageEdit: (id: string, text: string) => void;
	cancelQueuedMessageEdit: () => void;
	saveQueuedMessageEdit: (id: string) => void;
	removeQueuedMessage: (id: string) => void;
}) {
	const editInputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (isEditing) editInputRef.current?.focus();
	}, [isEditing]);
	return (
		<div {...stylex.props(styles.queueRow)}>
			<span {...stylex.props(styles.queueIndex)}>{index + 1}</span>
			{isEditing ? (
				<div {...stylex.props(styles.queueEditRow)}>
					<input
						ref={editInputRef}
						type="text"
						value={editingQueueText}
						onInput={setInputValue.bind(null, setEditingQueueText)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								saveQueuedMessageEdit(message.id);
							} else if (e.key === "Escape") {
								cancelQueuedMessageEdit();
							}
						}}
						{...stylex.props(styles.queueEditInput)}
					/>
					<IconButton
						type="button"
						onClick={() => saveQueuedMessageEdit(message.id)}
						variant="ghost"
						size="xs"
						className={stylex.props(styles.saveButton).className}
						title="Save"
					>
						<IconCheck size={iconSize.compact} />
					</IconButton>
					<IconButton
						type="button"
						onClick={cancelQueuedMessageEdit}
						variant="ghost"
						size="xs"
						title="Cancel"
					>
						<IconX size={iconSize.compact} />
					</IconButton>
				</div>
			) : (
				<>
					{message.images && message.images.length > 0 && (
						<img
							src={`/api/file?path=${encodeURIComponent(message.images[0]!)}`}
							alt=""
							{...stylex.props(styles.queueImage)}
						/>
					)}
					<span {...stylex.props(styles.queueText)}>{message.displayText}</span>
					{message.transient ? (
						<span {...stylex.props(styles.queueIndex)}>Steering…</span>
					) : (
						<div {...stylex.props(styles.queueActions)}>
							<IconButton
								type="button"
								onClick={() => startQueuedMessageEdit(message.id, message.text)}
								variant="ghost"
								size="xs"
								title="Edit"
							>
								<IconPencil size={iconSize.compact} />
							</IconButton>
							<IconButton
								type="button"
								onClick={() => removeQueuedMessage(message.id)}
								variant="danger"
								size="xs"
								title="Remove from queue"
							>
								<IconTrash size={iconSize.compact} />
							</IconButton>
						</div>
					)}
				</>
			)}
		</div>
	);
});
