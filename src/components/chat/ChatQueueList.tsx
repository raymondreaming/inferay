import * as stylex from "@stylexjs/stylex";
import type React from "react";
import type { QueuedMessageInfo } from "../../features/chat/agent-chat-shared.ts";
import { hasId } from "../../lib/data.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { IconButton } from "../ui/IconButton.tsx";
import { IconCheck, IconPencil, IconTrash, IconX } from "../ui/Icons.tsx";

interface ChatQueueListProps {
	queuedMessages: QueuedMessageInfo[];
	editingQueueId: string | null;
	setEditingQueueId: (id: string | null) => void;
	editingQueueText: string;
	setEditingQueueText: (text: string) => void;
	queueRef: React.RefObject<QueuedMessageInfo[]>;
	setQueuedMessages: (messages: QueuedMessageInfo[]) => void;
}

export function ChatQueueList({
	queuedMessages,
	editingQueueId,
	setEditingQueueId,
	editingQueueText,
	setEditingQueueText,
	queueRef,
	setQueuedMessages,
}: ChatQueueListProps) {
	if (queuedMessages.length === 0) return null;

	const saveQueuedEdit = (id: string) => {
		const trimmed = editingQueueText.trim();
		if (trimmed) {
			const item = queueRef.current?.find(hasId.bind(null, id));
			if (item) {
				item.text = trimmed;
				item.displayText = trimmed;
			}
			setQueuedMessages([...(queueRef.current ?? [])]);
		}
		setEditingQueueId(null);
	};

	return (
		<div {...stylex.props(styles.queueList)}>
			{queuedMessages.map((qm, idx) => (
				<div key={qm.id} {...stylex.props(styles.queueRow)}>
					<span {...stylex.props(styles.queueIndex)}>{idx + 1}</span>
					{editingQueueId === qm.id ? (
						<div {...stylex.props(styles.queueEditRow)}>
							<input
								type="text"
								ref={(el) => el?.focus()}
								value={editingQueueText}
								onChange={(event) => setEditingQueueText(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										saveQueuedEdit(qm.id);
									} else if (event.key === "Escape") {
										setEditingQueueId(null);
									}
								}}
								{...stylex.props(styles.queueEditInput)}
							/>
							<IconButton
								type="button"
								onClick={() => saveQueuedEdit(qm.id)}
								variant="ghost"
								size="xs"
								className={stylex.props(styles.saveButton).className}
								title="Save"
							>
								<IconCheck size={11} />
							</IconButton>
							<IconButton
								type="button"
								onClick={() => setEditingQueueId(null)}
								variant="ghost"
								size="xs"
								title="Cancel"
							>
								<IconX size={11} />
							</IconButton>
						</div>
					) : (
						<>
							{qm.images && qm.images.length > 0 && (
								<img
									src={`/api/file?path=${encodeURIComponent(qm.images[0]!)}`}
									alt=""
									{...stylex.props(styles.queueImage)}
								/>
							)}
							<span {...stylex.props(styles.queueText)}>{qm.displayText}</span>
							<div {...stylex.props(styles.queueActions)}>
								<IconButton
									type="button"
									onClick={() => {
										setEditingQueueId(qm.id);
										setEditingQueueText(qm.text);
									}}
									variant="ghost"
									size="xs"
									title="Edit"
								>
									<IconPencil size={11} />
								</IconButton>
								<IconButton
									type="button"
									onClick={() => {
										const next = (queueRef.current ?? []).filter(
											(q) => q.id !== qm.id
										);
										if (queueRef.current) queueRef.current = next;
										setQueuedMessages([...next]);
										if (editingQueueId === qm.id) {
											setEditingQueueId(null);
										}
									}}
									variant="danger"
									size="xs"
									title="Remove from queue"
								>
									<IconTrash size={11} />
								</IconButton>
							</div>
						</>
					)}
				</div>
			))}
		</div>
	);
}

const styles = stylex.create({
	queueList: {
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		flexShrink: 0,
		maxHeight: "112px",
		overflowY: "auto",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1,
	},
	queueRow: {
		alignItems: "flex-start",
		borderRadius: 8,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		transitionProperty: "background-color",
		transitionDuration: "120ms",
		":hover": {
			backgroundColor: color.backgroundRaised,
		},
	},
	queueIndex: {
		alignItems: "center",
		backgroundColor: color.surfaceSubtle,
		borderRadius: 999,
		color: color.textMuted,
		display: "inline-flex",
		flexShrink: 0,
		fontFamily: "var(--font-diff)",
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		height: controlSize._5,
		justifyContent: "center",
		minWidth: controlSize._5,
	},
	queueEditRow: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		gap: controlSize._1,
	},
	queueEditInput: {
		flex: 1,
		borderWidth: 0,
		borderRadius: "0.25rem",
		backgroundColor: color.surfaceControl,
		color: color.textMain,
		fontSize: "0.6875rem",
		outline: "none",
		paddingBlock: "0.125rem",
		paddingInline: controlSize._1,
	},
	saveButton: {
		color: color.accent,
	},
	queueImage: {
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		borderRadius: "0.25rem",
		objectFit: "cover",
	},
	queueText: {
		minWidth: 0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.6875rem",
	},
	queueActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: "0.125rem",
	},
});
