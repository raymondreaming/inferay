import { iconSize, surfaceStyles } from "@design-system/styles.stylex.ts";
import { APP_REGION_NO_DRAG_CLASS } from "@shared/lib/dom.tsx";
import { traceUi } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { ThinkingIndicator } from "@shared/ui/DotMatrixLoader/index.tsx";
import { IconFolder, IconStop } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { WorkspaceDockHandle } from "@workspace/components/WorkspaceDockHandle/index.tsx";
import { projects } from "@workspace/hooks/useProjects.tsx";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { AgentContextPanel } from "../AgentContextPanel/index.tsx";
import { ChatComposer } from "../ChatComposer/index.tsx";
import { AgentChatMessages } from "./AgentChatMessages.tsx";
import { styles } from "./styles.ts";
import {
	type AgentChatViewProps,
	useAgentChatState,
} from "./useAgentChatState.tsx";

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
	const workspaceName = createMemo(() => {
		const cwd = state.workspace.visibleCwd;
		return cwd ? cwd.split("/").pop() || cwd : null;
	});
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
						<WorkspaceDockHandle onDragStart={props.onDragStart} />
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
				<div {...stylex.attrs(styles.composerRegion)}>
					{imageDragActive() && (
						<div {...stylex.attrs(styles.imageDropCue)}>
							Drop image to attach
						</div>
					)}
					<div {...stylex.attrs(styles.composerContent)}>
						{state.connection.chatUiState.isLoading && (
							<div data-chat-activity {...stylex.attrs(styles.statusBar)}>
								<div {...stylex.attrs(styles.activity)}>
									{state.connection.chatUiState.startTime ? (
										<ThinkingIndicator
											active={state.visible()}
											startTime={state.connection.chatUiState.startTime}
										/>
									) : null}
								</div>
								<button
									type="button"
									onClick={state.stopGeneration}
									title="Stop generation"
									aria-label="Stop generation"
									{...stylex.attrs(styles.stopButton)}
								>
									<IconStop
										size={iconSize.md}
										{...stylex.attrs(styles.toolIcon)}
									/>
								</button>
							</div>
						)}
						{state.settings.configurationError && (
							<div role="alert" {...stylex.attrs(surfaceStyles.errorNotice)}>
								<span {...stylex.attrs(surfaceStyles.errorMessage)}>
									{state.settings.configurationError}
								</span>
								<Button size="sm" onClick={state.settings.retryConfiguration}>
									Retry
								</Button>
							</div>
						)}
						{state.composer.queueError && (
							<div role="alert" {...stylex.attrs(surfaceStyles.errorNotice)}>
								<span {...stylex.attrs(surfaceStyles.errorMessage)}>
									{state.composer.queueError}
								</span>
							</div>
						)}
						<ChatComposer
							active={state.visible()}
							{...state.composer}
							{...state.menus}
							beamActive={state.highlight.active()}
							agentKind={state.agentKind()}
							agentKindOptions={state.settings.agentKindOptions}
							model={state.settings.effectiveSelectedModel}
							reasoningLevel={state.settings.selectedReasoningLevel}
							onAgentKindChange={state.settings.handleAgentKindChange}
							onModelChange={state.settings.handleModelChange}
							onReasoningLevelChange={state.settings.handleReasoningLevelChange}
							onAgentConfigOpenChange={setConfigOpen}
							input={state.input()}
							setInput={state.setInput}
							handleKeyDown={state.inputActions.handleKeyDown}
							textareaRef={state.viewport.textareaRef}
							highlightOverlayRef={state.viewport.highlightOverlayRef}
							voiceInput={state.voiceInput}
							workspaceControl={
								workspaceName() &&
								!projects
									.list()
									.some(
										(project) =>
											project.directory === state.workspace.visibleCwd,
									) ? (
									<button
										type="button"
										data-chat-workspace
										onClick={(event) => {
											event.stopPropagation();
											setContextOpen(true);
										}}
										{...stylex.attrs(styles.projectButton)}
										class={`${APP_REGION_NO_DRAG_CLASS} ${stylex.attrs(styles.projectButton).class ?? ""}`}
										title={state.workspace.visibleCwd}
									>
										<IconFolder size={iconSize.sm} />
										<span {...stylex.attrs(styles.sessionLabel)}>
											{workspaceName()}
										</span>
									</button>
								) : null
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
