import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { WorkspaceAgentKind } from "../../../../../build/presentation/contracts/WorkspaceAgentKind.ts";
import {
	assignRef,
	bindImperativeRef,
	captureEvent,
} from "../../../../shared/lib/dom.tsx";
import {
	loadDefaultChatSettings,
	wsClient,
} from "../../../../shared/lib/native.tsx";
import { WorkspaceDockHandle } from "../../../workbench/components/WorkspaceDockHandle/index.tsx";
import {
	useAgentChatComposerState,
	usePendingChatWorkspace,
} from "../../hooks/useAgentChatComposerState.tsx";
import {
	useAgentChatMenus,
	useAgentChatSettings,
} from "../../hooks/useAgentChatMenus.tsx";
import { useChatDraft } from "../../hooks/useChatDraft.tsx";
import { useChatInputActions } from "../../hooks/useChatInputActions.tsx";
import { useSpeechToText } from "../../hooks/useSpeechToText.tsx";
import { AgentWorkspaceControl } from "../AgentChatHeader/index.tsx";
import { AgentChatStatusBar } from "../AgentChatStatusBar/index.tsx";
import { AgentContextPanel } from "../AgentContextPanel/index.tsx";
import { ChatComposer } from "../ChatComposer/index.tsx";
import { ChatMessageList } from "../ChatMessageList/index.tsx";
import { useChatViewport } from "../ChatMessageList/useChatViewport.tsx";
import { ChatWorkspacePicker } from "./ChatWorkspacePicker.tsx";
import { ScrollToLatestButton } from "./ScrollToLatestButton.tsx";
import { styles } from "./styles.ts";
import {
	appendSystemMessage,
	useChatConnection,
} from "./useChatConnection.tsx";
export interface AgentChatHandle {
	focusInput: (atEnd?: boolean) => void;
	highlightComposer: () => void;
}
export interface AgentChatViewProps {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];
	pendingWorkspacePaths?: string[];
	agentKind?: WorkspaceAgentKind;
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
	ref?: (handle: AgentChatHandle | null) => void;
}
export const AgentChatView = function AgentChatView(
	_props: AgentChatViewProps,
) {
	const renderVisibleChat = createMemo(() =>
		_props.isVisible === undefined ? true : _props.isVisible,
	);
	const [isContextOpen, setIsContextOpen] = createSignal(false);
	const [isAgentConfigOpen, setIsAgentConfigOpen] = createSignal(false);
	const _source = useAgentChatSettings(
		() => _props.paneId,
		() =>
			_props.agentKind === undefined
				? loadDefaultChatSettings().agentKind
				: _props.agentKind,
	);
	const _source2 = usePendingChatWorkspace(
		() => _props.paneId,
		() => _props.cwd,
		() => _props.pendingWorkspacePaths,
	);
	const { input, setInput } = useChatDraft(() => _props.paneId);
	const _source3 = useSpeechToText(() => ({
		enabled: renderVisibleChat(),
		value: input(),
		onChange: setInput,
	}));
	const imageDragDepthRef = {
		current: 0,
	};
	const [isImageDragActive, setIsImageDragActive] = createSignal(false);
	const [composerBeamActive, setComposerBeamActive] = createSignal(false);
	const composerBeamFrameRef = {
		current: 0,
	};
	const composerBeamTimerRef = {
		current: null,
	} as {
		current: ReturnType<typeof setTimeout> | null;
	};
	const highlightComposer = () => {
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
	};
	createEffect(
		() => [_props.isSelected],
		() => {
			if (_props.isSelected !== false) return;
			if (composerBeamFrameRef.current) {
				cancelAnimationFrame(composerBeamFrameRef.current);
				composerBeamFrameRef.current = 0;
			}
			if (composerBeamTimerRef.current) {
				clearTimeout(composerBeamTimerRef.current);
				composerBeamTimerRef.current = null;
			}
			setComposerBeamActive(false);
		},
	);
	onSettled(() => () => {
		if (composerBeamFrameRef.current) {
			cancelAnimationFrame(composerBeamFrameRef.current);
		}
		if (composerBeamTimerRef.current) {
			clearTimeout(composerBeamTimerRef.current);
		}
	});
	const _source4 = useChatViewport(
		() => input(),
		() => _props.isSelected,
		() => renderVisibleChat(),
	);
	const composer = useAgentChatComposerState(
		() => _props.paneId,
		() => renderVisibleChat(),
	);
	const menus = useAgentChatMenus(() => ({
		agentKind:
			_props.agentKind === undefined
				? loadDefaultChatSettings().agentKind
				: _props.agentKind,
		cwd: _props.cwd,
		enabled: renderVisibleChat(),
		input: input(),
		setInput,
		textareaRef: _source4.textareaRef,
	}));
	const exitChat = useStableCallback(() => _props.onClose?.(_props.paneId));
	const _source5 = useChatConnection(() => ({
		agentKind:
			_props.agentKind === undefined
				? loadDefaultChatSettings().agentKind
				: _props.agentKind,
		cwd: _props.cwd,
		enabled: renderVisibleChat(),
		paneId: _props.paneId,
		onExit: exitChat,
		replaceQueuedMessages: composer.replaceQueuedMessages,
		resolveSteeringMessage: composer.resolveSteeringMessage,
		stageSteeringMessage: composer.stageSteeringMessage,
	}));
	const _source6 = useChatInputActions(() => ({
		...composer,
		...menus,
		agentKind:
			_props.agentKind === undefined
				? loadDefaultChatSettings().agentKind
				: _props.agentKind,
		cancelSpeechListening: _source3.cancelListening,
		cwd: _props.cwd,
		input: input(),
		isLoading: _source5.chatUiState.isLoading,
		onSendStart: () => {
			_source4.scheduleScrollToBottom("auto");
		},
		paneId: _props.paneId,
		referencePaths: _props.referencePaths,
		setInput,
		setMessages: _source5.setMessages,
		textareaRef: _source4.textareaRef,
	}));
	const handleSendMessage = useStableCallback((text: string) =>
		_source6.sendUserMessage({
			text,
		}),
	);
	const handleMdFileClickFromMessage = useStableCallback(
		composer.handleMdFileClick,
	);
	const revertCheckpointFromMessage = useStableCallback(
		_source5.revertCheckpoint,
	);
	const stopGeneration = () => {
		wsClient.send({
			type: "chat:stop",
			paneId: _props.paneId,
		});
		_source5.setRunStatus({
			isLoading: false,
			status: "idle",
			startTime: null,
		});
		_source5.setMessages((prev) =>
			appendSystemMessage(prev, "Generation stopped"),
		);
		_source4.scheduleScrollToBottom("auto");
	};
	bindImperativeRef(
		() => _props.ref,
		() => ({
			focusInput: (atEnd?: boolean) => {
				const input = _source4.textareaRef.current;
				if (!input) return;
				input.focus();
				if (atEnd)
					input.setSelectionRange(input.value.length, input.value.length);
			},
			highlightComposer,
		}),
	);
	const toggleTool = (id: string) => {
		_source5.setExpandedTools((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	};
	const voiceInput = createMemo(() => ({
		error: _source3.error,
		isListening: _source3.isListening,
		isSupported: _source3.isSupported,
		onToggleListening: _source3.toggleListening,
	}));
	return (
		<div
			{...stylex.attrs(styles.root)}
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
				if (!isImageDragActive()) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
			}}
			onDragLeave={(event) => {
				if (!isImageDragActive()) return;
				event.stopPropagation();
				imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
				if (imageDragDepthRef.current === 0) setIsImageDragActive(false);
			}}
			onDrop={(event) => {
				if (!isImageDragActive()) return;
				event.stopPropagation();
				imageDragDepthRef.current = 0;
				setIsImageDragActive(false);
				void composer.handleDrop(event);
			}}
		>
			{renderVisibleChat() && _props.draggable && (
				<div {...stylex.attrs(styles.dragReveal)}>
					<div {...stylex.attrs(styles.dragRevealSurface)}>
						<WorkspaceDockHandle
							draggable
							onDragStart={_props.onDragStart}
							onDragEnd={_props.onDragEnd}
						/>
					</div>
				</div>
			)}
			{renderVisibleChat() && isContextOpen() && (
				<AgentContextPanel
					paneId={_props.paneId}
					cwd={_source2.visibleCwd}
					onClose={() => setIsContextOpen(false)}
				/>
			)}
			{renderVisibleChat() && !isContextOpen() && (
				<div {...stylex.attrs(styles.messageRegion)}>
					<div
						ref={[
							(_element) => assignRef(_source4.scrollRef, _element),
							captureEvent("wheel", (event) => _source4.cancelScrollRestore()),
						]}
						{...stylex.attrs(styles.scrollArea)}
						onScroll={_source4.handleScroll}
					>
						{_source5.messages.length === 0 &&
							!_source5.chatUiState.isLoading &&
							!_props.cwd &&
							!isAgentConfigOpen() &&
							_props.isSelected !== false &&
							_props.onDirectoryChange && (
								<ChatWorkspacePicker
									savePendingWorkspaceSelection={
										_source2.savePendingWorkspaceSelection
									}
									onDirectoryCancel={_props.onDirectoryCancel}
									paneId={_props.paneId}
								/>
							)}
						<ChatMessageList
							paneId={_props.paneId}
							messages={_source5.messages}
							scrollElementRef={_source4.scrollRef}
							virtualizerControlsRef={(handle) => {
								_source4.chatVirtualizerRef.current = handle;
							}}
							expandedTools={_source5.chatUiState.expandedTools}
							toggleTool={toggleTool}
							checkpoints={_source5.checkpoints}
							revertCheckpoint={revertCheckpointFromMessage}
							handleSendMessage={handleSendMessage}
							onMdFileClick={handleMdFileClickFromMessage}
							slashCommandNames={menus.slashCommandNames}
							stickToBottom={_source4.isAtBottom}
						/>
					</div>
					{!_source4.isAtBottom && (
						<ScrollToLatestButton scrollToBottom={_source4.scrollToBottom} />
					)}
				</div>
			)}

			{renderVisibleChat() && !isContextOpen() && (
				<div {...stylex.attrs(styles.composerRegion)}>
					{isImageDragActive() && (
						<div {...stylex.attrs(styles.imageDropCue)}>
							Drop image to attach
						</div>
					)}
					<div {...stylex.attrs(styles.composerContent)}>
						<AgentChatStatusBar
							isLoading={_source5.chatUiState.isLoading}
							startTime={_source5.chatUiState.startTime}
							onStop={stopGeneration}
						/>
						{_source.configurationError && (
							<div role="alert">{_source.configurationError}</div>
						)}
						{composer.queueError && (
							<div role="alert">{composer.queueError}</div>
						)}
						<ChatComposer
							{...composer}
							{...menus}
							beamActive={composerBeamActive()}
							agentKind={
								_props.agentKind === undefined
									? loadDefaultChatSettings().agentKind
									: _props.agentKind
							}
							agentKindOptions={_source.agentKindOptions}
							model={_source.effectiveSelectedModel}
							reasoningLevel={_source.selectedReasoningLevel}
							onAgentKindChange={_source.handleAgentKindChange}
							onModelChange={_source.handleModelChange}
							onReasoningLevelChange={_source.handleReasoningLevelChange}
							onAgentConfigOpenChange={setIsAgentConfigOpen}
							input={input()}
							setInput={setInput}
							handleKeyDown={_source6.handleKeyDown}
							textareaRef={_source4.textareaRef}
							highlightOverlayRef={_source4.highlightOverlayRef}
							onMdFileClick={composer.handleMdFileClick}
							voiceInput={voiceInput()}
							workspaceControl={
								<AgentWorkspaceControl
									cwd={_source2.visibleCwd}
									onAgentContext={() => setIsContextOpen((open) => !open)}
									isAgentContextOpen={isContextOpen()}
								/>
							}
						/>
					</div>
				</div>
			)}
		</div>
	);
};
export function useStableCallback<Args extends unknown[], Return>(
	callback: (...args: Args) => Return,
): (...args: Args) => Return {
	const callbackRef = {
		current: callback,
	};
	callbackRef.current = callback;
	return (...args: Args) => callbackRef.current(...args);
}
export type ChatLoadingState = {
	isLoading: boolean;
	status: string;
	startTime: number | null;
};
