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
import { wsClient } from "../../../../adapters/backend/websocket.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconArrowDown } from "../../../../shared/ui/Icons/index.tsx";
import { loadDefaultChatSettings } from "../../../agents/model/agents.ts";
import { WorkspaceDockHandle } from "../../../workbench/components/WorkspaceDockHandle/index.tsx";
import { InlineDirectoryPicker } from "../../../workspace/components/InlineDirectoryPicker/index.tsx";
import type { AgentKind } from "../../../workspace/model/workspace-model.ts";
import { useAgentChatComposerState } from "../../hooks/useAgentChatComposerState.tsx";
import { useAgentChatMenus } from "../../hooks/useAgentChatMenus.tsx";
import { useChatConnection } from "../../hooks/useChatConnection.ts";
import { useChatInputActions } from "../../hooks/useChatInputActions.tsx";
import { useSpeechToText } from "../../hooks/useSpeechToText.tsx";
import type {
	AttachedImageInfo,
	QueuedMessageInfo,
	ToolActivity,
} from "../../model/agent-chat-shared.ts";
import {
	loadStoredInput,
	saveStoredInput,
} from "../../model/chat-session-store.ts";
import {
	appendSystemMessage,
	windowChatMessagesForRender,
} from "../../model/chat-state-utils.ts";
import {
	type AgentChatSession,
	AgentWorkspaceControl,
} from "../AgentChatHeader/index.tsx";
import { AgentChatStatusBar } from "../AgentChatStatusBar/index.tsx";
import { AgentContextPanel } from "../AgentContextPanel/index.tsx";
import { ChatComposer } from "../ChatComposer/index.tsx";
import { ChatMessageList } from "../ChatMessageList/index.tsx";
import { DirectoryPickerModal } from "./DirectoryPickerModal.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import { useAgentChatSettings } from "./useAgentChatSettings.ts";
import { useChatUiState } from "./useChatUiState.ts";
import { useChatViewport } from "./useChatViewport.ts";
import { usePendingChatWorkspace } from "./usePendingChatWorkspace.ts";
import { usePersistentChatMessages } from "./usePersistentChatMessages.ts";
import { useStableCallback } from "./useStableCallback.ts";

export interface AgentChatHandle {
	sendMessage: (text: string) => void;
	sendMessageWithImages: (text: string, images?: string[]) => void;
	getStatus: () => string;
	focusInput: (atEnd?: boolean) => void;
	highlightComposer: () => void;
	getToolActivities: () => ToolActivity[];
	getQueuedCount: () => number;
	getQueuedMessages: () => QueuedMessageInfo[];
	removeQueuedMessage: (id: string) => void;
	updateQueuedMessage: (id: string, text: string) => void;
	stopGeneration: () => void;
	isLoading: () => boolean;
	getAttachedImages: () => AttachedImageInfo[];
	attachImageFile: (file: File) => Promise<void>;
	removeAttachedImage: (path: string) => void;
}

export interface AgentChatViewProps {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];
	showInput?: boolean;
	agentKind?: AgentKind;
	onStatusChange?: (paneId: string, status: string) => void;
	hideHeader?: boolean;
	onClose?: (paneId: string) => void;
	isSelected?: boolean;
	isVisible?: boolean;
	draggable?: boolean;
	onDragStart?: (e: PointerEvent) => void;
	onDragEnd?: () => void;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
	composerOnly?: boolean;
	composerOnlyOffsetX?: number;
	onExitComposerOnly?: () => void;
	/** Called when user picks directories from empty state picker */
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[],
	) => void;
	onDirectoryCancel?: (paneId: string) => void;
	/** Called when user wants to add a new pane of a specific agent kind */
	onAddPane?: (agentKind: AgentKind) => void;
	ref?: React.Ref<AgentChatHandle>;
}

export const AgentChatView = memo(function AgentChatView({
	paneId,
	cwd,
	referencePaths,
	showInput = true,
	agentKind = loadDefaultChatSettings().agentKind,
	onStatusChange,
	hideHeader,
	onClose,
	isSelected,
	isVisible = true,
	draggable,
	onDragStart,
	onDragEnd,
	sessions,
	onSelectSession,
	composerOnly = false,
	composerOnlyOffsetX = 0,
	onExitComposerOnly,
	onDirectoryChange,
	onDirectoryCancel,
	ref,
}: AgentChatViewProps) {
	const renderVisibleChat = composerOnly || isVisible;
	const [isContextOpen, setIsContextOpen] = useState(false);
	const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);
	const { getToolActivities, messageReadModel, messages, setMessages } =
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
		enabled: renderVisibleChat && showInput,
		value: input,
		onChange: setInput,
	});
	const { chatUiState, setChatUiState, setExpandedTools, setRunStatus } =
		useChatUiState(paneId, onStatusChange);
	const { isLoading, status, startTime, expandedTools } = chatUiState;
	const inputContainerRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
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
	const {
		attachedImages,
		queuedMessages,
		queueError,
		replaceQueuedMessages,
		resolveSteeringMessage,
		stageSteeringMessage,
		removeQueuedMessage,
		updateQueuedMessage,
		editingQueueId,
		editingQueueText,
		setEditingQueueText,
		startQueuedMessageEdit,
		cancelQueuedMessageEdit,
		saveQueuedMessageEdit,
		mdPreview,
		setMdPreview,
		handleMdFileClick,
		attachImage,
		removeAttachedImage,
		clearAttachedImages,
		handleDrop,
		handlePaste,
	} = useAgentChatComposerState(paneId, renderVisibleChat);
	const {
		allCommands,
		fileMenu,
		setFileMenu,
		fileResults,
		slashMenu,
		setSlashMenu,
		filteredCommands,
		showCommands,
		slashCommandNames,
		handleInputForFileMenu,
		handleInputForSlashMenu,
		selectCommand,
		selectFile,
	} = useAgentChatMenus({
		agentKind,
		cwd,
		enabled: renderVisibleChat,
		input,
		setInput,
		textareaRef,
		inputContainerRef,
		containerRef,
	});
	const { checkpoints, clearCheckpoints, resetStreamState, revertCheckpoint } =
		useChatConnection({
			agentKind,
			cwd,
			enabled: renderVisibleChat,
			messageReadModel,
			paneId,
			replaceQueuedMessages,
			resolveSteeringMessage,
			stageSteeringMessage,
			setChatUiState,
			setRunStatus,
		});
	const { handleKeyDown, sendUserMessage } = useChatInputActions({
		agentKind,
		allCommands,
		attachedImages,
		cancelSpeechListening,
		clearAttachedImages,
		clearCheckpoints,
		composerOnly,
		consumePendingWorkspace,
		cwd,
		effectiveSelectedModel,
		enabled: renderVisibleChat,
		fileMenu,
		fileResults,
		filteredCommands,
		input,
		isLoading,
		onSendStart: () => {
			resetStreamState();
			scheduleScrollToBottom("auto");
		},
		onExit: onClose ? () => onClose(paneId) : undefined,
		onExitComposerOnly,
		paneId,
		referencePaths,
		selectCommand,
		selectFile,
		selectedReasoningLevel,
		setFileMenu,
		setInput,
		setRunStatus,
		setMessages,
		setSlashMenu,
		showCommands,
		slashMenu,
		textareaRef,
	});
	const handleSendMessage = useStableCallback((text: string) =>
		sendUserMessage({ text, workspaceOverride: consumePendingWorkspace() }),
	);
	const handleMdFileClickFromMessage = useStableCallback(handleMdFileClick);
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
			sendMessage: (text: string) => {
				const trimmed = text.trim();
				if (!trimmed) return;
				sendUserMessage({ text: trimmed });
			},
			sendMessageWithImages: (text: string, images?: string[]) => {
				const trimmed = text.trim();
				if (!trimmed) return;
				sendUserMessage({ images, text: trimmed });
			},
			getStatus: () => status,
			focusInput: (atEnd?: boolean) => {
				const ta = textareaRef.current;
				if (!ta) return;
				ta.focus();
				if (atEnd) ta.setSelectionRange(ta.value.length, ta.value.length);
			},
			highlightComposer,
			getToolActivities,
			getQueuedCount: () => queuedMessages.length,
			getQueuedMessages: () =>
				queuedMessages.map((queued) => ({
					id: queued.id,
					text: queued.text,
					displayText: queued.displayText,
					images: queued.images,
				})),
			removeQueuedMessage,
			updateQueuedMessage,
			stopGeneration,
			isLoading: () => isLoading,
			getAttachedImages: () => [...attachedImages],
			attachImageFile: attachImage,
			removeAttachedImage,
		}),
		[
			attachImage,
			attachedImages,
			isLoading,
			getToolActivities,
			highlightComposer,
			queuedMessages,
			removeAttachedImage,
			removeQueuedMessage,
			sendUserMessage,
			status,
			stopGeneration,
			textareaRef,
			updateQueuedMessage,
		],
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
			ref={containerRef}
			{...stylex.props(styles.root, composerOnly && styles.composerOnlyRoot)}
			style={
				composerOnly
					? inlineStyles.getAgentChatViewRootStyle(
							`calc(50% + ${composerOnlyOffsetX}px)`,
						)
					: undefined
			}
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
				void handleDrop(event);
			}}
		>
			{renderVisibleChat && !hideHeader && !composerOnly && draggable && (
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
			{renderVisibleChat && !composerOnly && isContextOpen && (
				<AgentContextPanel
					paneId={paneId}
					cwd={visibleCwd}
					onClose={() => setIsContextOpen(false)}
				/>
			)}
			{renderVisibleChat && !composerOnly && !isContextOpen && (
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
							slashCommandNames={slashCommandNames}
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
						{queueError && <div role="alert">{queueError}</div>}
						<ChatComposer
							showInput={showInput}
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
							attachedImages={attachedImages}
							removeAttachedImage={removeAttachedImage}
							attachImage={attachImage}
							queuedMessages={queuedMessages}
							editingQueueId={editingQueueId}
							editingQueueText={editingQueueText}
							setEditingQueueText={setEditingQueueText}
							startQueuedMessageEdit={startQueuedMessageEdit}
							cancelQueuedMessageEdit={cancelQueuedMessageEdit}
							saveQueuedMessageEdit={saveQueuedMessageEdit}
							removeQueuedMessage={removeQueuedMessage}
							fileMenu={fileMenu}
							setFileMenu={setFileMenu}
							fileResults={fileResults}
							selectFile={selectFile}
							slashMenu={slashMenu}
							setSlashMenu={setSlashMenu}
							showCommands={showCommands}
							filteredCommands={filteredCommands}
							slashCommandNames={slashCommandNames}
							selectCommand={selectCommand}
							handleInputForFileMenu={handleInputForFileMenu}
							handleInputForSlashMenu={handleInputForSlashMenu}
							handleKeyDown={handleKeyDown}
							handlePaste={handlePaste}
							textareaRef={textareaRef}
							highlightOverlayRef={highlightOverlayRef}
							inputContainerRef={inputContainerRef}
							mdPreview={mdPreview}
							setMdPreview={setMdPreview}
							onMdFileClick={handleMdFileClick}
							voiceInput={voiceInput}
							workspaceControl={
								!hideHeader && !composerOnly ? (
									<AgentWorkspaceControl
										paneId={paneId}
										cwd={visibleCwd}
										sessions={sessions}
										onSelectSession={onSelectSession}
										onAgentContext={() => setIsContextOpen((open) => !open)}
										isAgentContextOpen={isContextOpen}
									/>
								) : null
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
});

export { useAgentChatSettings } from "./useAgentChatSettings.ts";
export { useChatUiState } from "./useChatUiState.ts";

export { useChatViewport } from "./useChatViewport.ts";
export { usePendingChatWorkspace } from "./usePendingChatWorkspace.ts";
export { usePersistentChatMessages } from "./usePersistentChatMessages.ts";
