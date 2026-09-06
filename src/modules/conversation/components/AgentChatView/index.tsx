import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "octane";
import type React from "react";
import { wsClient } from "../../../../adapters/backend/http.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconArrowDown } from "../../../../shared/ui/Icons/index.tsx";
import { loadDefaultChatSettings } from "../../../agents/model/agents.ts";
import { WorkspaceDockHandle } from "../../../workbench/components/WorkspaceDockHandle/index.tsx";
import { InlineDirectoryPicker } from "../../../workspace/components/InlineDirectoryPicker/index.tsx";
import type { WorkspaceModelAgentKind as AgentKind } from "../../../workspace/model/workspace-model.ts";
import { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { useChatInputActions } from "../../hooks/useChatInputActions.tsx";
import { useSpeechToText } from "../../hooks/useSpeechToText.tsx";
import {
	appendSystemMessage,
	windowChatMessagesForRender,
} from "../../model/agent-chat-shared.ts";
import {
	loadStoredInput,
	saveStoredInput,
	useAgentChatSettings,
	useChatConnection,
	useChatUiState,
	useChatViewport,
	usePendingChatWorkspace,
	usePersistentChatMessages,
	useStableCallback,
} from "../../model/chat-session-store.ts";
import { AgentWorkspaceControl } from "../AgentChatHeader/index.tsx";
import { AgentChatStatusBar } from "../AgentChatStatusBar/index.tsx";
import { AgentContextPanel } from "../AgentContextPanel/index.tsx";
import { ChatComposer } from "../ChatComposer/index.tsx";
import { ChatMessageList } from "../ChatMessageList/index.tsx";
import { DirectoryPickerModal } from "./DirectoryPickerModal.tsx";
import { styles } from "./styles.ts";

export interface AgentChatHandle {
	focusInput: (atEnd?: boolean) => void;
	highlightComposer: () => void;
}

export interface AgentChatViewProps {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];

	agentKind?: AgentKind;

	onClose?: (paneId: string) => void;
	isSelected?: boolean;
	isVisible?: boolean;
	draggable?: boolean;
	onDragStart?: (e: PointerEvent) => void;
	onDragEnd?: () => void;

	/** Called when user picks directories from empty state picker */
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[],
	) => void;
	onDirectoryCancel?: (paneId: string) => void;

	ref?: React.Ref<AgentChatHandle>;
}

export const AgentChatView = memo(function AgentChatView({
	paneId,
	cwd,
	referencePaths,

	agentKind = loadDefaultChatSettings().agentKind,

	onClose,
	isSelected,
	isVisible = true,
	draggable,
	onDragStart,
	onDragEnd,

	onDirectoryChange,
	onDirectoryCancel,
	ref,
}: AgentChatViewProps) {
	const renderVisibleChat = isVisible;
	const [isContextOpen, setIsContextOpen] = useState(false);
	const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);
	const { messageReadModel, messages, setMessages } =
		usePersistentChatMessages(paneId);
	const visibleMessages = useMemo(
		() => windowChatMessagesForRender(messages),
		[messages],
	);
	const {
		configurationError,
		agentKindOptions,
		effectiveSelectedModel,
		handleAgentKindChange,
		handleModelChange,
		handleReasoningLevelChange,
		selectedReasoningLevel,
	} = useAgentChatSettings(paneId, agentKind);
	const { consumePendingWorkspace, savePendingWorkspaceSelection, visibleCwd } =
		usePendingChatWorkspace(paneId, cwd, onDirectoryChange);
	const [input, setInputRaw] = useState(() => loadStoredInput(paneId));
	const pendingInputRef = useRef(input);
	const inputSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushInputSave = useCallback(() => {
		if (inputSaveTimerRef.current) {
			clearTimeout(inputSaveTimerRef.current);
			inputSaveTimerRef.current = null;
		}
		saveStoredInput(paneId, pendingInputRef.current);
	}, [paneId]);
	const setInput = useCallback(
		(val: string) => {
			setInputRaw(val);
			pendingInputRef.current = val;
			if (inputSaveTimerRef.current) return;
			inputSaveTimerRef.current = setTimeout(flushInputSave, 250);
		},
		[flushInputSave],
	);
	useEffect(() => () => flushInputSave(), [flushInputSave]);
	const {
		cancelListening: cancelSpeechListening,
		error: speechError,
		isListening: isSpeechListening,
		isSupported: isSpeechSupported,
		toggleListening: toggleSpeechListening,
	} = useSpeechToText({
		enabled: renderVisibleChat,
		value: input,
		onChange: setInput,
	});
	const { chatUiState, setExpandedTools, setRunStatus } =
		useChatUiState(paneId);
	const { isLoading, startTime, expandedTools } = chatUiState;
	const imageDragDepthRef = useRef(0);
	const [isImageDragActive, setIsImageDragActive] = useState(false);
	const [composerBeamActive, setComposerBeamActive] = useState(false);
	const composerBeamFrameRef = useRef(0);
	const composerBeamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const highlightComposer = useCallback(() => {
		if (composerBeamFrameRef.current) {
			cancelAnimationFrame(composerBeamFrameRef.current);
		}
		if (composerBeamTimerRef.current) {
			clearTimeout(composerBeamTimerRef.current);
		}
		setComposerBeamActive(false);
		composerBeamFrameRef.current = requestAnimationFrame(() => {
			composerBeamFrameRef.current = 0;
			setComposerBeamActive(true);
			composerBeamTimerRef.current = setTimeout(() => {
				composerBeamTimerRef.current = null;
				setComposerBeamActive(false);
			}, 1_800);
		});
	}, []);
	useEffect(() => {
		if (isSelected !== false) return;
		if (composerBeamFrameRef.current) {
			cancelAnimationFrame(composerBeamFrameRef.current);
			composerBeamFrameRef.current = 0;
		}
		if (composerBeamTimerRef.current) {
			clearTimeout(composerBeamTimerRef.current);
			composerBeamTimerRef.current = null;
		}
		setComposerBeamActive(false);
	}, [isSelected]);
	useEffect(
		() => () => {
			if (composerBeamFrameRef.current) {
				cancelAnimationFrame(composerBeamFrameRef.current);
			}
			if (composerBeamTimerRef.current) {
				clearTimeout(composerBeamTimerRef.current);
			}
		},
		[],
	);
	const {
		cancelActivationRestore,
		chatVirtualizerRef,
		handleScroll,
		isAtBottom,
		highlightOverlayRef,
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	} = useChatViewport(input, isSelected, renderVisibleChat);
	const composer = useAgentChatComposerState(paneId, renderVisibleChat);
	const menus = useAgentChatMenus({
		agentKind,
		cwd,
		enabled: renderVisibleChat,
		input,
		setInput,
		textareaRef,
	});
	const { checkpoints, clearCheckpoints, revertCheckpoint } = useChatConnection(
		{
			agentKind,
			cwd,
			enabled: renderVisibleChat,
			messageReadModel,
			paneId,
			replaceQueuedMessages: composer.replaceQueuedMessages,
			resolveSteeringMessage: composer.resolveSteeringMessage,
			stageSteeringMessage: composer.stageSteeringMessage,
			setExpandedTools,
			setRunStatus,
		},
	);
	const { handleKeyDown, sendUserMessage } = useChatInputActions({
		...composer,
		...menus,
		agentKind,
		cancelSpeechListening,
		clearCheckpoints,

		consumePendingWorkspace,
		cwd,
		effectiveSelectedModel,
		input,
		isLoading,
		onSendStart: () => {
			scheduleScrollToBottom("auto");
		},
		onExit: onClose ? () => onClose(paneId) : undefined,

		paneId,
		referencePaths,
		selectedReasoningLevel,
		setInput,
		setRunStatus,
		setMessages,
		textareaRef,
	});
	const handleSendMessage = useStableCallback((text: string) =>
		sendUserMessage({ text, workspaceOverride: consumePendingWorkspace() }),
	);
	const handleMdFileClickFromMessage = useStableCallback(
		composer.handleMdFileClick,
	);
	const revertCheckpointFromMessage = useStableCallback(revertCheckpoint);
	const stopGeneration = useCallback(() => {
		wsClient.send({ type: "chat:stop", paneId });
		setRunStatus({ isLoading: false, status: "idle", startTime: null });
		setMessages((prev) => appendSystemMessage(prev, "Generation stopped"));
		scheduleScrollToBottom("auto");
	}, [paneId, scheduleScrollToBottom, setMessages, setRunStatus]);
	useImperativeHandle(
		ref,
		() => ({
			focusInput: (atEnd?: boolean) => {
				const input = textareaRef.current;
				if (!input) return;
				input.focus();
				if (atEnd)
					input.setSelectionRange(input.value.length, input.value.length);
			},
			highlightComposer,
		}),
		[textareaRef, highlightComposer],
	);

	const toggleTool = useCallback(
		(id: string) => {
			setExpandedTools((prev) => {
				const next = new Set(prev);
				next.has(id) ? next.delete(id) : next.add(id);
				return next;
			});
		},
		[setExpandedTools],
	);
	const voiceInput = useMemo(
		() => ({
			error: speechError,
			isListening: isSpeechListening,
			isSupported: isSpeechSupported,
			onToggleListening: toggleSpeechListening,
		}),
		[isSpeechListening, isSpeechSupported, speechError, toggleSpeechListening],
	);

	return (
		<div
			{...stylex.props(styles.root)}
			onDragEnter={(event) => {
				const transfer = event.dataTransfer;
				if (!transfer) return;
				const hasImage = Array.from(transfer.items).some(
					(item) => item.kind === "file" && item.type.startsWith("image/"),
				);
				if (!hasImage) return;
				event.preventDefault();
				event.stopPropagation();
				imageDragDepthRef.current += 1;
				setIsImageDragActive(true);
			}}
			onDragOver={(event) => {
				if (!isImageDragActive) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			}}
			onDragLeave={(event) => {
				if (!isImageDragActive) return;
				event.stopPropagation();
				imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
				if (imageDragDepthRef.current === 0) setIsImageDragActive(false);
			}}
			onDrop={(event) => {
				if (!isImageDragActive) return;
				event.stopPropagation();
				imageDragDepthRef.current = 0;
				setIsImageDragActive(false);
				void composer.handleDrop(event);
			}}
		>
			{renderVisibleChat && draggable && (
				<div {...stylex.props(styles.dragReveal)}>
					<div {...stylex.props(styles.dragRevealSurface)}>
						<WorkspaceDockHandle
							draggable
							onDragStart={onDragStart}
							onDragEnd={onDragEnd}
						/>
					</div>
				</div>
			)}
			{renderVisibleChat && isContextOpen && (
				<AgentContextPanel
					paneId={paneId}
					cwd={visibleCwd}
					onClose={() => setIsContextOpen(false)}
				/>
			)}
			{renderVisibleChat && !isContextOpen && (
				<div {...stylex.props(styles.messageRegion)}>
					<div
						ref={scrollRef}
						{...stylex.props(styles.scrollArea)}
						onScroll={handleScroll}
						onWheelCapture={cancelActivationRestore}
					>
						{messages.length === 0 &&
							!isLoading &&
							!cwd &&
							!isAgentConfigOpen &&
							isSelected !== false &&
							onDirectoryChange && (
								<div {...stylex.props(styles.directoryPickerWrap)}>
									<DirectoryPickerModal>
										<div {...stylex.props(styles.directoryPickerInner)}>
											<InlineDirectoryPicker
												onSelect={(path) => {
													if (path) onDirectoryChange(paneId, path);
													else onDirectoryCancel?.(paneId);
												}}
												onCancel={onDirectoryCancel?.bind(null, paneId)}
												multiSelect
												showStartButton={false}
												onSelectionChange={(paths) => {
													savePendingWorkspaceSelection(paths);
												}}
												onMultiSelect={(paths) => {
													if (paths.length > 0) {
														onDirectoryChange(
															paneId,
															paths[0]!,
															paths.slice(1),
														);
													}
												}}
											/>
										</div>
									</DirectoryPickerModal>
								</div>
							)}
						<ChatMessageList
							paneId={paneId}
							messages={visibleMessages}
							scrollElementRef={scrollRef}
							virtualizerControlsRef={chatVirtualizerRef}
							expandedTools={expandedTools}
							toggleTool={toggleTool}
							checkpoints={checkpoints}
							revertCheckpoint={revertCheckpointFromMessage}
							handleSendMessage={handleSendMessage}
							onMdFileClick={handleMdFileClickFromMessage}
							slashCommandNames={menus.slashCommandNames}
							stickToBottom={isAtBottom}
						/>
					</div>
					{!isAtBottom && (
						<button
							type="button"
							onPointerDown={(event) => {
								if (event.button === 0 && event.isPrimary) scrollToBottom();
							}}
							onClick={(event) => {
								if (event.detail === 0) scrollToBottom();
							}}
							{...stylex.props(styles.scrollButton)}
						>
							<IconArrowDown
								size={iconSize.md}
								{...stylex.props(styles.scrollIcon)}
							/>
						</button>
					)}
				</div>
			)}

			{renderVisibleChat && !isContextOpen && (
				<div {...stylex.props(styles.composerRegion)}>
					{isImageDragActive && (
						<div {...stylex.props(styles.imageDropCue)}>
							Drop image to attach
						</div>
					)}
					<div {...stylex.props(styles.composerContent)}>
						<AgentChatStatusBar
							isLoading={isLoading}
							startTime={startTime}
							onStop={stopGeneration}
						/>
						{configurationError && <div role="alert">{configurationError}</div>}
						{composer.queueError && (
							<div role="alert">{composer.queueError}</div>
						)}
						<ChatComposer
							{...composer}
							{...menus}
							beamActive={composerBeamActive}
							agentKind={agentKind}
							agentKindOptions={agentKindOptions}
							model={effectiveSelectedModel}
							reasoningLevel={selectedReasoningLevel}
							onAgentKindChange={handleAgentKindChange}
							onModelChange={handleModelChange}
							onReasoningLevelChange={handleReasoningLevelChange}
							onAgentConfigOpenChange={setIsAgentConfigOpen}
							input={input}
							setInput={setInput}
							handleKeyDown={handleKeyDown}
							textareaRef={textareaRef}
							highlightOverlayRef={highlightOverlayRef}
							onMdFileClick={composer.handleMdFileClick}
							voiceInput={voiceInput}
							workspaceControl={
								<AgentWorkspaceControl
									cwd={visibleCwd}
									onAgentContext={() => setIsContextOpen((open) => !open)}
									isAgentContextOpen={isContextOpen}
								/>
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
});

export {
	useAgentChatSettings,
	useChatUiState,
	useChatViewport,
	usePendingChatWorkspace,
	usePersistentChatMessages,
} from "../../model/chat-session-store.ts";
