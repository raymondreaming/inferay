import * as stylex from "@stylexjs/stylex";
import { createMemo, onSettled } from "solid-js";
import type { ChatListRow } from "../../../../../build/presentation/contracts/ChatListRow.ts";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { GroupedEditDiff } from "../ChatEditDiff/index.tsx";
import { Bubble } from "./Bubble.tsx";
import { CheckpointMarker } from "./CheckpointMarker.tsx";
import { styles } from "./styles.ts";
import { ToolTimeline } from "./ToolTimeline.tsx";
export function ChatRenderRow(_props: {
	observeRow: (element: HTMLDivElement) => () => void;
	item: ChatListRow;
	index: number;
	rowKey: string;
	paneId: string;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	messages: readonly ChatMessage[];
	checkpoint: CheckpointMeta | undefined;
	revertCheckpoint: (id: string) => void;
	handleSendMessage: ((text: string) => void) | undefined;
	onMdFileClick: ((path: string) => void) | undefined;
	slashCommandNames: readonly string[];
}) {
	let element: HTMLDivElement | undefined;
	onSettled(() => (element ? _props.observeRow(element) : undefined));
	const msg = createMemo(() =>
		_props.item.type === "message" ? _props.messages[_props.item.index]! : null,
	);
	return (
		<div
			ref={(value) => (element = value)}
			data-chat-row-key={_props.rowKey}
			data-chat-row-index={_props.index}
			{...stylex.attrs(
				styles.messageRow,
				_props.item.type === "tool-group" &&
					_props.item.continuesAfter &&
					styles.continuingToolRow,
			)}
		>
			{_props.item.type === "edit-group" ? (
				<GroupedEditDiff
					filePath={_props.item.filePath}
					edits={_props.messages.slice(_props.item.start, _props.item.end)}
				/>
			) : _props.item.type === "tool-group" ? (
				<ToolTimeline
					tools={[_props.messages[_props.item.index]!]}
					continuesAfter={_props.item.continuesAfter}
					expandedTools={_props.expandedTools}
					onToggle={_props.toggleTool}
				/>
			) : (
				msg() && (
					<>
						<Bubble
							paneId={_props.paneId}
							msg={msg()!}
							collapsed={!_props.expandedTools.has(msg()!.id)}
							onToggle={_props.toggleTool}
							onSendMessage={_props.handleSendMessage}
							onMdFileClick={_props.onMdFileClick}
							slashCommandNames={_props.slashCommandNames}
						/>
						{_props.checkpoint && (
							<CheckpointMarker
								checkpoint={_props.checkpoint}
								onRevert={_props.revertCheckpoint}
							/>
						)}
					</>
				)
			)}
		</div>
	);
}
