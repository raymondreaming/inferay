import * as stylex from "@octanejs/stylex";
import type { ChatListRow } from "../../../../../build/presentation/contracts/ChatListRow.ts";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { GroupedEditDiff } from "../ChatEditDiff/index.tsx";
import { Bubble } from "./Bubble.tsx";
import { CheckpointMarker } from "./CheckpointMarker.tsx";
import { styles } from "./styles.ts";
import { ToolTimeline } from "./ToolTimeline.tsx";
export function ChatRenderRow({
	item,
	index,
	rowKey,
	paneId,
	expandedTools,
	toggleTool,
	messages,
	checkpoint,
	revertCheckpoint,
	handleSendMessage,
	onMdFileClick,
	slashCommandNames,
}: {
	item: ChatListRow;
	index: number;
	rowKey: string;
	paneId: string;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	messages: ChatMessage[];
	checkpoint: CheckpointMeta | undefined;
	revertCheckpoint: (id: string) => void;
	handleSendMessage: ((text: string) => void) | undefined;
	onMdFileClick: ((path: string) => void) | undefined;
	slashCommandNames: readonly string[];
}) {
	const msg = item.type === "message" ? messages[item.index]! : null;
	return (
		<div
			data-chat-row-key={rowKey}
			data-chat-row-index={index}
			{...stylex.props(
				styles.messageRow,
				item.type === "tool-group" &&
					item.continuesAfter &&
					styles.continuingToolRow,
			)}
		>
			{item.type === "edit-group" ? (
				<GroupedEditDiff
					filePath={item.filePath}
					edits={messages.slice(item.start, item.end)}
				/>
			) : item.type === "tool-group" ? (
				<ToolTimeline
					tools={[messages[item.index]!]}
					continuesAfter={item.continuesAfter}
					expandedTools={expandedTools}
					onToggle={toggleTool}
				/>
			) : (
				msg && (
					<>
						<Bubble
							paneId={paneId}
							msg={msg}
							collapsed={!expandedTools.has(msg.id)}
							onToggle={toggleTool}
							onSendMessage={handleSendMessage}
							onMdFileClick={onMdFileClick}
							slashCommandNames={slashCommandNames}
						/>
						{checkpoint && (
							<CheckpointMarker
								checkpoint={checkpoint}
								onRevert={revertCheckpoint}
							/>
						)}
					</>
				)
			)}
		</div>
	);
}
