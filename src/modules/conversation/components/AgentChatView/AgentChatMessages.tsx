import { iconSize } from "@design-system/styles.stylex.ts";
import { IconArrowDown } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { InlineDirectoryPicker } from "@workspace/components/InlineDirectoryPicker/index.tsx";
import { onSettled } from "solid-js";
import { ChatMessageList } from "../ChatMessageList/index.tsx";
import { styles } from "./styles.ts";
import type {
	AgentChatState,
	AgentChatViewProps,
} from "./useAgentChatState.tsx";
export function AgentChatMessages(
	props: Pick<
		AgentChatViewProps,
		"paneId" | "cwd" | "isSelected" | "onDirectoryChange" | "onDirectoryCancel"
	> & { state: AgentChatState; configOpen: boolean },
) {
	let element: HTMLDivElement | undefined;
	onSettled(() => {
		const viewport = props.state.viewport;
		return () => {
			if (viewport.scrollRef.current === element)
				viewport.scrollRef.current = null;
		};
	});
	return (
		<div {...stylex.attrs(styles.messageRegion)}>
			{/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The scroll viewport needs keyboard focus for Page Up/Down. */}
			<div
				data-chat-scroll-area
				role="region"
				aria-label="Conversation history"
				tabindex={0}
				ref={(node) => {
					element = node;
					props.state.viewport.scrollRef.current = node;
				}}
				{...stylex.attrs(styles.scrollArea)}
				onScroll={props.state.viewport.handleScroll}
			>
				{/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
				{props.state.connection.messages.length === 0 &&
					!props.state.connection.chatUiState.isLoading &&
					!props.cwd &&
					!props.configOpen &&
					props.isSelected !== false &&
					props.onDirectoryChange && (
						<div {...stylex.attrs(styles.directoryPickerWrap)}>
							<div
								class="inferay-directory-picker-modal"
								role="dialog"
								aria-label="Choose workspace folders"
							>
								<div {...stylex.attrs(styles.directoryPickerInner)}>
									<InlineDirectoryPicker
										onCancel={() => {
											props.state.workspace.savePendingWorkspaceSelection([]);
											props.onDirectoryCancel?.(props.paneId);
										}}
										onSelectionChange={
											props.state.workspace.savePendingWorkspaceSelection
										}
									/>
								</div>
							</div>
						</div>
					)}
				<ChatMessageList
					active={props.state.visible()}
					paneId={props.paneId}
					transcript={props.state.connection.transcript}
					scrollElementRef={props.state.viewport.scrollRef}
					virtualizerControlsRef={(handle) => {
						props.state.viewport.chatVirtualizerRef.current = handle;
					}}
					expandedTools={props.state.connection.chatUiState.expandedTools}
					toggleTool={props.state.toggleTool}
					checkpoints={props.state.connection.checkpoints}
					revertCheckpoint={props.state.connection.revertCheckpoint}
					handleSendMessage={props.state.sendMessage}
					onMdFileClick={props.state.composer.handleMdFileClick}
					slashCommandNames={props.state.menus.slashCommandNames}
					stickToBottom={props.state.viewport.following}
				/>
			</div>
			{!props.state.viewport.following && (
				<button
					type="button"
					aria-label="Scroll to latest and follow new messages"
					onPointerDown={(event) => {
						if (event.button === 0 && event.isPrimary)
							props.state.viewport.scrollToBottom();
					}}
					onClick={(event) => {
						if (event.detail === 0) props.state.viewport.scrollToBottom();
					}}
					{...stylex.attrs(styles.scrollButton)}
				>
					<IconArrowDown
						size={iconSize.md}
						{...stylex.attrs(styles.scrollIcon)}
					/>
				</button>
			)}
		</div>
	);
}
