import { traceUi } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { WorkspaceDockHandle } from "@workspace/components/WorkspaceDockHandle/index.tsx";
import { createEffect, createSignal, onSettled } from "solid-js";
import { AgentContextPanel } from "../AgentContextPanel/index.tsx";
import { AgentChatComposer } from "./AgentChatComposer.tsx";
import { AgentChatMessages } from "./AgentChatMessages.tsx";
import { styles } from "./styles.ts";
import {
	type AgentChatViewProps,
	useAgentChatState,
} from "./useAgentChatState.tsx";

export type { ChatLoadingState } from "@contracts";
export type {
	AgentChatHandle,
	AgentChatViewProps,
} from "./useAgentChatState.tsx";

export function AgentChatView(props: AgentChatViewProps) {
	onSettled(() => {
		traceUi("pane-mounted");
		return () => traceUi("pane-unmounted");
	});
	const state = useAgentChatState(props);
	const [contextOpen, setContextOpen] = createSignal(false);
	const [configOpen, setConfigOpen] = createSignal(false);
	const [imageDragActive, setImageDragActive] = createSignal(false);
	let imageDragDepth = 0;
	const resetImageDrag = () => {
		imageDragDepth = 0;
		setImageDragActive(false);
	};
	createEffect(
		() => state.visible() && !contextOpen(),
		(enabled) => {
			if (enabled) return;
			resetImageDrag();
		},
	);
	const imageDragHandlers = {
		onDragEnter(event: DragEvent) {
			if (!state.visible() || contextOpen() || !event.dataTransfer) return;
			if (
				!Array.from(event.dataTransfer.items).some(
					(item) => item.kind === "file" && item.type.startsWith("image/"),
				)
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			imageDragDepth++;
			setImageDragActive(true);
		},
		onDragOver(event: DragEvent) {
			if (!imageDragDepth) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
		},
		onDragLeave(event: DragEvent) {
			if (!imageDragDepth) return;
			event.stopPropagation();
			imageDragDepth = Math.max(0, imageDragDepth - 1);
			if (!imageDragDepth) setImageDragActive(false);
		},
		onDrop(event: DragEvent) {
			if (!imageDragDepth) return;
			event.stopPropagation();
			resetImageDrag();
			void state.composer.handleDrop(event);
		},
	};
	return (
		<div
			data-chat-pane-id={props.paneId}
			data-chat-ready={
				state.connection.chatUiState.transcriptReady ? "true" : "false"
			}
			{...stylex.attrs(styles.root)}
			{...imageDragHandlers}
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
					imageDragActive={imageDragActive()}
					setConfigOpen={setConfigOpen}
					openContext={() => setContextOpen(true)}
				/>
			)}
		</div>
	);
}
