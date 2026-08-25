import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "octane";
import type React from "react";
import {
	type AgentKind,
	changePaneAgentKind,
	dispatchAgentShellChange,
} from "../../features/agent/agent-utils.ts";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";
import type {
	AttachedImageInfo,
	ChatLoadingState,
	ChatUiState,
	QueuedMessageInfo,
	ToolActivity,
} from "../../features/chat/agent-chat-shared.ts";
import {
	clearStoredSessionId,
	getChatMessageReadModel,
	getChatRunStatusReadModel,
	loadPendingWorkspacePaths,
	loadStoredInput,
	loadStoredModel,
	loadStoredReasoningLevel,
	savePendingWorkspacePaths,
	saveStoredInput,
	saveStoredModel,
	saveStoredReasoningLevel,
} from "../../features/chat/chat-session-store.ts";
import { useGitStatus } from "../../features/git/useGitStatus.tsx";
import { hasId } from "../../lib/data.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { wsClient } from "../../lib/websocket.ts";
import { InlineDirectoryPicker } from "../../pages/Agent/InlineDirectoryPicker.tsx";
import { color, colorValues, controlSize } from "../../tokens.stylex.ts";
import type { ReactNode } from "../../types/octane-react-compat.ts";
import { Liquid } from "../ui/gooey/index.ts";
import { IconArrowDown } from "../ui/Icons.tsx";
import { AgentChatHeader, type AgentChatSession } from "./AgentChatHeader.tsx";
import { AgentChatStatusBar } from "./AgentChatStatusBar.tsx";
import { AgentContextPanel } from "./AgentContextPanel.tsx";
import { ChatComposer } from "./ChatComposer.tsx";
import {
	ChatMessageList,
	type ChatVirtualizerControls,
} from "./ChatMessageList.tsx";
import { extractToolActivities } from "./chat-agent-utils.ts";
import {
	appendSystemMessage,
	windowChatMessagesForRender,
} from "./chat-state-utils.ts";
import { useAgentChatComposerState } from "./useAgentChatComposerState.tsx";
import { useAgentChatMenus } from "./useAgentChatMenus.tsx";
import { useChatConnection } from "./useChatConnection.tsx";
import { useChatInputActions } from "./useChatInputActions.tsx";
import { useSpeechToText } from "./useSpeechToText.tsx";

export interface AgentChatHandle {
	sendMessage: (text: string) => void;
	sendMessageWithImages: (text: string, images?: string[]) => void;
	getStatus: () => string;
	focusInput: (atEnd?: boolean) => void;
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

const EMPTY_CWD_LIST: string[] = [];

function DirectoryPickerModal({ children }: { children: ReactNode }) {
	return (
		<div
			className="inferay-directory-picker-modal"
			role="dialog"
			aria-label="Choose workspace folders"
		>
			<Liquid
				blur={5}
				contrast={20}
				fill={colorValues.backgroundRaised}
				filterPadding={20}
				shadow="inset 0 1px 0 rgba(255,255,255,.08), 0 14px 36px rgba(0,0,0,.32)"
				className="inferay-directory-picker-liquid"
			>
				<Liquid.Item observe radius={12}>
					{children}
				</Liquid.Item>
			</Liquid>
		</div>
	);
}

function useStableCallback<Args extends unknown[], Return>(
	callback: (...args: Args) => Return,
): (...args: Args) => Return {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;
	return useCallback((...args: Args) => callbackRef.current(...args), []);
}

function usePersistentChatMessages(paneId: string) {
	const messageReadModel = useMemo(
		() => getChatMessageReadModel(paneId),
		[paneId],
	);
	const messages = useSyncExternalStore(
		messageReadModel.subscribe,
		messageReadModel.getSnapshot,
		messageReadModel.getSnapshot,
	);
	const getToolActivities = useCallback(
		() => extractToolActivities(messageReadModel.get()),
		[messageReadModel],
	);

	useEffect(() => {
		messageReadModel.setSummaryChangeCallback(() => {
			dispatchAgentShellChange({
				source: "cache",
				reason: "session-title",
			});
		});
		return () => {
			messageReadModel.setSummaryChangeCallback(() => {});
		};
	}, [messageReadModel]);
	useEffect(() => {
		void messageReadModel.loadAsync();
		return () => messageReadModel.flush();
	}, [messageReadModel]);

	return {
		getToolActivities,
		messageReadModel,
		messages,
		setMessages: messageReadModel.set,
	};
}

function useAgentChatSettings(paneId: string, agentKind: AgentKind) {
	const getDefaultModel = useCallback((kind: AgentKind) => {
		const definition = getAgentDefinition(kind);
		const defaults = loadDefaultChatSettings();
		return kind === defaults.agentKind &&
			definition.models.some(hasId.bind(null, defaults.model))
			? defaults.model
			: definition.defaultModel;
	}, []);
	const [selectedModel, setSelectedModel] = useState(() => {
		const stored = loadStoredModel(paneId);
		const definition = getAgentDefinition(agentKind);
		const defaults = loadDefaultChatSettings();
		return definition.models.some(hasId.bind(null, stored))
			? stored!
			: agentKind === defaults.agentKind &&
					definition.models.some(hasId.bind(null, defaults.model))
				? defaults.model
				: definition.defaultModel;
	});
	const [selectedReasoningLevel, setSelectedReasoningLevel] = useState(() => {
		const stored = loadStoredReasoningLevel(paneId);
		const defaults = loadDefaultChatSettings();
		return CODEX_REASONING_LEVELS.some(hasId.bind(null, stored))
			? stored!
			: defaults.reasoningLevel;
	});
	const agentDefinition = useMemo(
		() => getAgentDefinition(agentKind),
		[agentKind],
	);
	const effectiveSelectedModel = agentDefinition.models.some(
		hasId.bind(null, selectedModel),
	)
		? selectedModel
		: getDefaultModel(agentKind);
	const agentKindOptions = useMemo(
		() => [
			{
				id: "claude" as const,
				label: "Claude",
				icon: getAgentIcon("claude", 11),
			},
			{ id: "codex" as const, label: "Codex", icon: getAgentIcon("codex", 11) },
		],
		[],
	);
	const prevAgentKindRef = useRef(agentKind);

	useEffect(() => {
		if (prevAgentKindRef.current === agentKind) return;
		prevAgentKindRef.current = agentKind;
		clearStoredSessionId(paneId);
	}, [agentKind, paneId]);

	const handleAgentKindChange = useCallback(
		(nextAgentKind: AgentKind) => {
			changePaneAgentKind(paneId, nextAgentKind);
			clearStoredSessionId(paneId);
			const nextModel = getDefaultModel(nextAgentKind);
			if (!nextModel) return;
			setSelectedModel(nextModel);
			saveStoredModel(paneId, nextModel);
		},
		[getDefaultModel, paneId],
	);
	const handleModelChange = useCallback(
		(model: string) => {
			setSelectedModel(model);
			saveStoredModel(paneId, model);
			clearStoredSessionId(paneId);
		},
		[paneId],
	);
	const handleReasoningLevelChange = useCallback(
		(reasoningLevel: string) => {
			setSelectedReasoningLevel(reasoningLevel);
			saveStoredReasoningLevel(paneId, reasoningLevel);
			clearStoredSessionId(paneId);
		},
		[paneId],
	);

	return {
		agentKindOptions,
		effectiveSelectedModel,
		handleAgentKindChange,
		handleModelChange,
		handleReasoningLevelChange,
		selectedReasoningLevel,
	};
}

function useChatViewport(
	input: string,
	isSelected?: boolean,
	isVisible = true,
) {
	type ScrollSnapshot = {
		atBottom: boolean;
		fromBottom: number;
		top: number;
	};
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const chatVirtualizerRef = useRef<ChatVirtualizerControls | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const highlightOverlayRef = useRef<HTMLDivElement | null>(null);
	const wasSelectedRef = useRef(isSelected);
	const activationRestoreFrameRef = useRef(0);
	const scrollSnapshotRef = useRef<ScrollSnapshot>({
		atBottom: true,
		fromBottom: 0,
		top: 0,
	});
	const [isAtBottom, setIsAtBottom] = useState(true);
	const captureScrollSnapshot = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const fromBottom = Math.max(
			0,
			el.scrollHeight - el.scrollTop - el.clientHeight,
		);
		scrollSnapshotRef.current = {
			atBottom: fromBottom < 48,
			fromBottom,
			top: el.scrollTop,
		};
	}, []);
	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const nextIsAtBottom =
			chatVirtualizerRef.current?.isAtEnd() ??
			el.scrollHeight - el.scrollTop - el.clientHeight < 48;
		setIsAtBottom(nextIsAtBottom);
		if (!isSelected) captureScrollSnapshot();
	}, [captureScrollSnapshot, isSelected]);
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (!el) return;
		if (chatVirtualizerRef.current) {
			chatVirtualizerRef.current.scrollToEnd(behavior);
		} else {
			el.scrollTo({ top: el.scrollHeight, behavior });
		}
		setIsAtBottom(true);
	}, []);
	const scheduleScrollToBottom = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => scrollToBottom(behavior));
			});
		},
		[scrollToBottom],
	);
	useLayoutEffect(() => {
		const wasSelected = wasSelectedRef.current;
		wasSelectedRef.current = isSelected;
		if (wasSelected && !isSelected) {
			captureScrollSnapshot();
			return;
		}
		if (wasSelected || !isSelected || !isVisible) return;
		const el = scrollRef.current;
		if (!el) return;
		const snapshot = scrollSnapshotRef.current;
		let passes = 6;
		const restoreViewport = () => {
			const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = snapshot.atBottom
				? Math.max(0, maxScrollTop - snapshot.fromBottom)
				: Math.min(snapshot.top, maxScrollTop);
			setIsAtBottom(snapshot.atBottom);
			passes -= 1;
			if (passes > 0) {
				activationRestoreFrameRef.current =
					requestAnimationFrame(restoreViewport);
			} else {
				activationRestoreFrameRef.current = 0;
			}
		};
		restoreViewport();
		return () => {
			if (activationRestoreFrameRef.current) {
				cancelAnimationFrame(activationRestoreFrameRef.current);
				activationRestoreFrameRef.current = 0;
			}
		};
	}, [captureScrollSnapshot, isSelected, isVisible]);
	const cancelActivationRestore = useCallback(() => {
		if (!activationRestoreFrameRef.current) return;
		cancelAnimationFrame(activationRestoreFrameRef.current);
		activationRestoreFrameRef.current = 0;
	}, []);
	useEffect(() => {
		if (!isVisible) return;
		const ta = textareaRef.current;
		if (!ta) return;
		if (!input) {
			ta.style.height = "20px";
		} else {
			ta.style.height = "20px";
			ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 20), 120)}px`;
		}
		if (highlightOverlayRef.current) {
			highlightOverlayRef.current.style.transform = `translateY(-${ta.scrollTop}px)`;
		}
	}, [input, isVisible]);
	const handleWindowKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key !== "ArrowDown") return;
			const active = document.activeElement;
			if (
				active &&
				(active.tagName === "TEXTAREA" || active.tagName === "INPUT")
			)
				return;
			if (!isAtBottom) {
				e.preventDefault();
				scrollToBottom();
			}
		},
		[isAtBottom, scrollToBottom],
	);
	useEffect(() => {
		if (!isSelected || !isVisible) return;
		return listenWindowEvent("keydown", handleWindowKeyDown);
	}, [handleWindowKeyDown, isSelected, isVisible]);

	return {
		chatVirtualizerRef,
		handleScroll,
		highlightOverlayRef,
		isAtBottom,
		cancelActivationRestore,
		scheduleScrollToBottom,
		scrollRef,
		scrollToBottom,
		textareaRef,
	};
}

function useChatUiState(
	paneId: string,
	onStatusChange?: (paneId: string, status: string) => void,
) {
	const runStatusReadModel = useMemo(
		() => getChatRunStatusReadModel(paneId),
		[paneId],
	);
	const runStatus = useSyncExternalStore(
		runStatusReadModel.subscribe,
		runStatusReadModel.getSnapshot,
		runStatusReadModel.getSnapshot,
	);
	const [chatUiControls, setChatUiControls] = useState<
		Pick<ChatUiState, "expandedTools" | "liveActivities">
	>(() => ({
		expandedTools: new Set(),
		liveActivities: [],
	}));
	const chatUiState = useMemo(
		() => ({
			...runStatus,
			...chatUiControls,
		}),
		[chatUiControls, runStatus],
	);
	const setRunStatus = useCallback(
		(
			value: ChatLoadingState | ((prev: ChatLoadingState) => ChatLoadingState),
		) => {
			const prev = runStatusReadModel.get();
			const next = runStatusReadModel.set(value);
			if (prev.status !== next.status) onStatusChange?.(paneId, next.status);
		},
		[onStatusChange, paneId, runStatusReadModel],
	);
	const setExpandedTools = useCallback(
		(value: Set<string> | ((prev: Set<string>) => Set<string>)) => {
			setChatUiControls((prev) => {
				const expandedTools =
					typeof value === "function" ? value(prev.expandedTools) : value;
				if (prev.expandedTools === expandedTools) return prev;
				return { ...prev, expandedTools };
			});
		},
		[],
	);

	return {
		chatUiState,
		setChatUiState: setChatUiControls,
		setExpandedTools,
		setRunStatus,
	};
}

function usePendingChatWorkspace(
	paneId: string,
	cwd: string | undefined,
	onDirectoryChange:
		| ((paneId: string, cwd: string, referencePaths?: string[]) => void)
		| undefined,
) {
	const pendingWorkspacePathsRef = useRef<string[]>([]);
	const [pendingWorkspacePaths, setPendingWorkspacePaths] = useState(() =>
		loadPendingWorkspacePaths(paneId).filter(Boolean),
	);
	const visibleCwd = cwd ?? pendingWorkspacePaths[0];
	const cwdList = useMemo(() => (visibleCwd ? [visibleCwd] : []), [visibleCwd]);
	const clearPendingWorkspacePaths = useCallback(() => {
		pendingWorkspacePathsRef.current = [];
		setPendingWorkspacePaths([]);
		savePendingWorkspacePaths(paneId, []);
	}, [paneId]);
	const consumePendingWorkspace = useCallback(() => {
		const paths = (
			pendingWorkspacePathsRef.current.length > 0
				? pendingWorkspacePathsRef.current
				: loadPendingWorkspacePaths(paneId)
		).filter(Boolean);
		const selectedWorkspace =
			!cwd && paths.length > 0
				? { cwd: paths[0], referencePaths: paths.slice(1) }
				: undefined;
		if (selectedWorkspace?.cwd) {
			onDirectoryChange?.(
				paneId,
				selectedWorkspace.cwd,
				selectedWorkspace.referencePaths,
			);
			clearPendingWorkspacePaths();
		}
		return selectedWorkspace;
	}, [clearPendingWorkspacePaths, cwd, onDirectoryChange, paneId]);
	const savePendingWorkspaceSelection = useCallback(
		(paths: string[]) => {
			const nextPaths = paths.filter(Boolean);
			pendingWorkspacePathsRef.current = nextPaths;
			setPendingWorkspacePaths(nextPaths);
			savePendingWorkspacePaths(paneId, nextPaths);
		},
		[paneId],
	);

	return {
		consumePendingWorkspace,
		cwdList,
		savePendingWorkspaceSelection,
		visibleCwd,
	};
}

interface AgentChatViewProps {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];
	gitBranch?: string | null;
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
	gitBranch: providedGitBranch,
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
		agentKindOptions,
		effectiveSelectedModel,
		handleAgentKindChange,
		handleModelChange,
		handleReasoningLevelChange,
		selectedReasoningLevel,
	} = useAgentChatSettings(paneId, agentKind);
	const {
		consumePendingWorkspace,
		cwdList,
		savePendingWorkspaceSelection,
		visibleCwd,
	} = usePendingChatWorkspace(paneId, cwd, onDirectoryChange);
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
	const shouldLoadGitBranch =
		providedGitBranch === undefined && renderVisibleChat;
	const { projects: gitProjects } = useGitStatus(
		shouldLoadGitBranch ? cwdList : EMPTY_CWD_LIST,
		{ enabled: shouldLoadGitBranch && cwdList.length > 0 },
	);
	const gitBranch = providedGitBranch ?? gitProjects[0]?.branch ?? null;

	const { chatUiState, setChatUiState, setExpandedTools, setRunStatus } =
		useChatUiState(paneId, onStatusChange);
	const { isLoading, status, startTime, expandedTools } = chatUiState;
	const inputContainerRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const imageDragDepthRef = useRef(0);
	const [isImageDragActive, setIsImageDragActive] = useState(false);
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
		incrementUsage,
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
		incrementUsage,
		input,
		isLoading,
		onSendStart: () => {
			resetStreamState();
			scheduleScrollToBottom("auto");
		},
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
					? {
							left: `calc(50% + ${composerOnlyOffsetX}px)`,
						}
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
			{renderVisibleChat && !hideHeader && !composerOnly && (
				<AgentChatHeader
					paneId={paneId}
					cwd={visibleCwd}
					gitBranch={gitBranch}
					draggable={draggable}
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
					onClose={onClose}
					sessions={sessions}
					onSelectSession={onSelectSession}
					onAgentContext={() => setIsContextOpen((open) => !open)}
					isAgentContextOpen={isContextOpen}
				/>
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
												liquidSurface
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
							<IconArrowDown size={12} {...stylex.props(styles.scrollIcon)} />
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
						<ChatComposer
							showInput={showInput}
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
							isLoading={isLoading}
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
						/>
					</div>
				</div>
			)}
		</div>
	);
});

const styles = stylex.create({
	root: {
		display: "flex",
		position: "relative",
		height: "100%",
		flexDirection: "column",
		transitionProperty: "box-shadow",
		transitionDuration: "120ms",
	},
	composerOnlyRoot: {
		position: "absolute",
		zIndex: 50,
		left: "50%",
		bottom: controlSize._6,
		width: "min(36rem, calc(100% - 2rem))",
		height: "auto",
		transform: "translateX(-50%)",
	},
	messageRegion: {
		position: "relative",
		flex: 1,
		overflow: "hidden",
	},
	scrollArea: {
		height: "100%",
		overflowX: "hidden",
		overflowY: "auto",
		overflowAnchor: "none",
		overscrollBehavior: "contain",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	directoryPickerWrap: {
		position: "absolute",
		zIndex: 10,
		left: 0,
		right: 0,
		bottom: 0,
		pointerEvents: "none",
		paddingInline: controlSize._3,
		paddingBottom: 14,
	},
	directoryPickerInner: {
		width: "100%",
		pointerEvents: "auto",
	},
	scrollButton: {
		position: "absolute",
		zIndex: 10,
		right: controlSize._2,
		bottom: controlSize._2,
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: "999px",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlHover,
		},
		boxShadow: "0 1px 2px rgba(0, 0, 0, 0.24)",
		transitionProperty: "background-color, opacity",
		transitionDuration: "120ms",
	},
	scrollIcon: {
		color: color.textSoft,
	},
	composerRegion: {
		position: "relative",
		flexShrink: 0,
	},
	imageDropCue: {
		position: "absolute",
		left: "50%",
		bottom: "calc(100% + 8px)",
		zIndex: 20,
		transform: "translateX(-50%)",
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.borderStrong,
		borderRadius: controlSize._2,
		backgroundColor: color.surfaceGlassStrong,
		color: color.textSoft,
		fontSize: "0.625rem",
		fontWeight: 600,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
		pointerEvents: "none",
		whiteSpace: "nowrap",
	},
	composerContent: {
		position: "relative",
		zIndex: 10,
	},
});
