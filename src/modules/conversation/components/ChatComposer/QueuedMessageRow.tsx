import * as stylex from "@stylexjs/stylex";
import { createEffect } from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { setInputValue } from "../../../../shared/lib/dom.tsx";
import { IconButton } from "../../../../shared/ui/IconButton/index.tsx";
import {
	IconCheck,
	IconPencil,
	IconTrash,
	IconX,
} from "../../../../shared/ui/Icons/index.tsx";
import type { QueuedChatMessage } from "../../hooks/useAgentChatComposerState.tsx";
import { styles } from "./styles.ts";
export const QueuedMessageRow = function QueuedMessageRow(_props: {
	index: number;
	message: QueuedChatMessage;
	isEditing: boolean;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	startQueuedMessageEdit: (id: string, text: string) => void;
	cancelQueuedMessageEdit: () => void;
	saveQueuedMessageEdit: (id: string) => void;
	removeQueuedMessage: (id: string) => void;
}) {
	const editInputRef = {
		current: null,
	} as {
		current: HTMLInputElement | null;
	};
	createEffect(
		() => [_props.isEditing],
		() => {
			if (_props.isEditing) editInputRef.current?.focus();
		},
	);
	return (
		<div {...stylex.attrs(styles.queueRow)}>
			<span {...stylex.attrs(styles.queueIndex)}>{_props.index + 1}</span>
			{_props.isEditing ? (
				<div {...stylex.attrs(styles.queueEditRow)}>
					<input
						ref={(element) => (editInputRef.current = element)}
						type="text"
						value={_props.editingQueueText}
						onInput={setInputValue.bind(null, _props.setEditingQueueText)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								_props.saveQueuedMessageEdit(_props.message.id);
							} else if (e.key === "Escape") {
								_props.cancelQueuedMessageEdit();
							}
						}}
						{...stylex.attrs(styles.queueEditInput)}
					/>
					<IconButton
						type="button"
						onClick={() => _props.saveQueuedMessageEdit(_props.message.id)}
						variant="ghost"
						size="xs"
						class={stylex.attrs(styles.saveButton).class}
						title="Save"
					>
						<IconCheck size={iconSize.compact} />
					</IconButton>
					<IconButton
						type="button"
						onClick={_props.cancelQueuedMessageEdit}
						variant="ghost"
						size="xs"
						title="Cancel"
					>
						<IconX size={iconSize.compact} />
					</IconButton>
				</div>
			) : (
				<>
					{_props.message.images && _props.message.images.length > 0 && (
						<img
							src={`/api/file?path=${encodeURIComponent(_props.message.images[0]!)}`}
							alt=""
							{...stylex.attrs(styles.queueImage)}
						/>
					)}
					<span {...stylex.attrs(styles.queueText)}>
						{_props.message.displayText}
					</span>
					{_props.message.transient ? (
						<span {...stylex.attrs(styles.queueIndex)}>Steering…</span>
					) : (
						<div {...stylex.attrs(styles.queueActions)}>
							<IconButton
								type="button"
								onClick={() =>
									_props.startQueuedMessageEdit(
										_props.message.id,
										_props.message.text,
									)
								}
								variant="ghost"
								size="xs"
								title="Edit"
							>
								<IconPencil size={iconSize.compact} />
							</IconButton>
							<IconButton
								type="button"
								onClick={() => _props.removeQueuedMessage(_props.message.id)}
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
};
