import { captureEvent } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { onSettled } from "solid-js";
import { ChatMessageList } from "../ChatMessageList/index.tsx";
import { ChatWorkspacePicker } from "./ChatWorkspacePicker.tsx";
import { ScrollToLatestButton } from "./ScrollToLatestButton.tsx";
import { styles } from "./styles.ts";
import type { AgentChatViewProps } from "./types.ts";
import type { AgentChatState } from "./useAgentChatState.tsx";
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
			<div
				ref={[
					(node) => {
						element = node;
						props.state.viewport.scrollRef.current = node;
					},
					captureEvent("wheel", (_event) =>
						props.state.viewport.cancelScrollRestore(),
					),
				]}
				{...stylex.attrs(styles.scrollArea)}
				onScroll={props.state.viewport.handleScroll}
			>
				{props.state.connection.messages.length === 0 &&
					!props.state.connection.chatUiState.isLoading &&
					!props.cwd &&
					!props.configOpen &&
					props.isSelected !== false &&
					props.onDirectoryChange && (
						<ChatWorkspacePicker
							savePendingWorkspaceSelection={
								props.state.workspace.savePendingWorkspaceSelection
							}
							onDirectoryCancel={props.onDirectoryCancel}
							paneId={props.paneId}
						/>
					)}
				<ChatMessageList
					active={props.state.visible()}
					paneId={props.paneId}
					messages={props.state.connection.messages}
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
					stickToBottom={props.state.viewport.isAtBottom}
				/>
			</div>
			{!props.state.viewport.isAtBottom && (
				<ScrollToLatestButton
					scrollToBottom={props.state.viewport.scrollToBottom}
				/>
			)}
		</div>
	);
}
