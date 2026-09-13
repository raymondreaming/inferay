import { traceUi } from "@shared/lib/uiPerformance.ts";
import * as stylex from "@stylexjs/stylex";
import { WorkspaceDockHandle } from "@workspace/components/WorkspaceDockHandle/index.tsx";
import { createSignal, onSettled } from "solid-js";
import { AgentContextPanel } from "../AgentContextPanel/index.tsx";
import { AgentChatComposer } from "./AgentChatComposer.tsx";
import { AgentChatMessages } from "./AgentChatMessages.tsx";
import { styles } from "./styles.ts";
import type { AgentChatViewProps } from "./types.ts";
import { useAgentChatState } from "./useAgentChatState.tsx";
import { useImageDrop } from "./useImageDrop.ts";

export type {
	AgentChatHandle,
	AgentChatViewProps,
	ChatLoadingState,
} from "./types.ts";

export function AgentChatView(props: AgentChatViewProps) {
	onSettled(() => {
		traceUi("pane-mounted");
		return () => traceUi("pane-unmounted");
	});
	const state = useAgentChatState(props);
	const [contextOpen, setContextOpen] = createSignal(false);
	const [configOpen, setConfigOpen] = createSignal(false);
	const images = useImageDrop(
		() => state.visible() && !contextOpen(),
		state.composer.handleDrop,
	);
	return (
		<div
			data-chat-pane-id={props.paneId}
			data-chat-ready={
				state.connection.chatUiState.transcriptReady ? "true" : "false"
			}
			{...stylex.attrs(styles.root)}
			{...images.handlers}
		>
			{state.visible() && props.draggable && (
				<div {...stylex.attrs(styles.dragReveal)}>
					<div {...stylex.attrs(styles.dragRevealSurface)}>
						<WorkspaceDockHandle
							draggable
							onDragStart={props.onDragStart}
							onDragEnd={props.onDragEnd}
						/>
					</div>
				</div>
			)}
			{state.visible() && contextOpen() && (
				<AgentContextPanel
					paneId={props.paneId}
					cwd={state.workspace.visibleCwd}
					onClose={() => setContextOpen(false)}
				/>
			)}
			{!contextOpen() && (
				<AgentChatMessages
					state={state}
					paneId={props.paneId}
					cwd={props.cwd}
					isSelected={props.isSelected}
					onDirectoryChange={props.onDirectoryChange}
					onDirectoryCancel={props.onDirectoryCancel}
					configOpen={configOpen()}
				/>
			)}
			{!contextOpen() && (
				<AgentChatComposer
					state={state}
					imageDragActive={images.active()}
					setConfigOpen={setConfigOpen}
					openContext={() => setContextOpen(true)}
				/>
			)}
		</div>
	);
}
