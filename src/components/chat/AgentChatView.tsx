import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useGitStatus } from "../../hooks/useGitStatus.ts";
import { usePrompts } from "../../hooks/usePrompts.ts";
import { getAgentIcon } from "../../lib/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
} from "../../lib/agents.ts";
import { measureTextareaHeight } from "../../lib/pretext-utils.ts";
import {
	type AgentKind,
	changePaneAgentKind,
} from "../../lib/terminal-utils.ts";
import { wsClient } from "../../lib/websocket.ts";
import { InlineDirectoryPicker } from "../../pages/Terminal/InlineDirectoryPicker.tsx";
import { NewSessionButtons } from "../../pages/Terminal/NewSessionButtons.tsx";
import { IconArrowDown } from "../ui/Icons.tsx";
import { AgentChatHeader } from "./AgentChatHeader.tsx";
import { AgentChatStatusBar } from "./AgentChatStatusBar.tsx";
import {
	type AgentChatSession,
	type AttachedImageInfo,
	addMessage,
	type ChatMessage,
	type CheckpointInfo,
	nextId,
	type QueuedMessageInfo,
	type SlashCommand,
	trimMessages,
} from "./agent-chat-shared.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import { ChatMessageList } from "./ChatMessageList.tsx";
import {
	extractToolActivities,
	type ToolActivity,
} from "./chat-agent-utils.ts";
import {
	expandInlineCommandPrompts,
	getCommandDisplayText,
	getCommandPrompt,
} from "./chat-command-utils.ts";
import {
	clearAgentChatMessages,
	clearStoredCheckpoints,
	clearStoredSessionId,
	loadStoredCheckpoints,
	loadStoredInput,
	loadStoredMessages,
	loadStoredModel,
	loadStoredReasoningLevel,
	loadStoredSessionId,
	saveStoredCheckpoints,
	saveStoredInput,
	saveStoredMessages,
	saveStoredModel,
	saveStoredReasoningLevel,
	saveStoredSessionId,
} from "./chat-session-store.ts";
import {
	appendMessageContent,
	mergeSyncedMessages,
	patchMessageById,
} from "./chat-state-utils.ts";
import { useAgentChatComposerState } from "./useAgentChatComposerState.ts";
import { useAgentChatMenus } from "./useAgentChatMenus.ts";

interface AgentChatViewProps {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];
	showInput?: boolean;
	agentKind?: AgentKind;
	onStatusChange?: (paneId: string, status: string) => void;
	hideHeader?: boolean;
	onClose?: (paneId: string) => void;
	isSelected?: boolean;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
	onDragEnd?: () => void;
	sessions?: AgentChatSession[];
	onSelectSession?: (paneId: string) => void;
	/** Called when user picks directories from empty state picker */
	onDirectoryChange?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[]
	) => void;
	/** Called when user wants to add a new pane of a specific agent kind */
	onAddPane?: (agentKind: AgentKind) => void;
}

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

const LOCAL_COMMANDS: SlashCommand[] = [
	{
		name: "clear",
		description: "Clear all messages",
		action: "local",
		isLocalCommand: true,
	},
	{
		name: "help",
		description: "Show available commands",
		action: "local",
		isLocalCommand: true,
	},
];

export const AgentChatView = forwardRef<AgentChatHandle, AgentChatViewProps>(
	function AgentChatView(
		{
			paneId,
			cwd,
			referencePaths,
			showInput = true,
			agentKind = "claude",
			onStatusChange,
			hideHeader,
			onClose,
			isSelected,
			draggable,
			onDragStart,
			onDragEnd,
			sessions,
			onSelectSession,
			onDirectoryChange,
			onAddPane,
		},
		ref
	) {
		const [messages, setMessagesRaw] = useState<ChatMessage[]>(() =>
			loadStoredMessages<ChatMessage>(paneId).map((message) => ({
				...message,
				isStreaming: false,
			}))
		);
		const messagesRef = useRef(messages);
		messagesRef.current = messages;
		const getDefaultModel = useCallback(
			(kind: AgentKind) => getAgentDefinition(kind).defaultModel,
			[]
		);
		const [selectedModel, setSelectedModel] = useState(() => {
			const stored = loadStoredModel(paneId);
			const definition = getAgentDefinition(agentKind);
			return definition.models.some((model) => model.id === stored)
				? stored!
				: definition.defaultModel;
		});
		const [selectedReasoningLevel, setSelectedReasoningLevel] = useState(() => {
			const stored = loadStoredReasoningLevel(paneId);
			return CODEX_REASONING_LEVELS.some((level) => level.id === stored)
				? stored!
				: "low";
		});
		const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const scheduleMessageSave = useCallback(
			(nextMessages: ChatMessage[]) => {
				if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
				if (nextMessages.some((message) => message.isStreaming)) return;
				saveTimerRef.current = setTimeout(() => {
					saveStoredMessages(paneId, nextMessages);
				}, 2000);
			},
			[paneId]
		);
		const setMessages = useCallback(
			(update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
				setMessagesRaw((prev) => {
					const next =
						typeof update === "function"
							? (update as (prev: ChatMessage[]) => ChatMessage[])(prev)
							: update;
					messagesRef.current = next;
					scheduleMessageSave(next);
					return next;
				});
			},
			[scheduleMessageSave]
		);
		useEffect(
			() => () => {
				if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			},
			[]
		);
		const [input, setInputRaw] = useState(() => loadStoredInput(paneId));
		const inputRef = useRef(input);
		const inputUndoHistoryRef = useRef<string[]>([]);
		const inputRedoHistoryRef = useRef<string[]>([]);
		const setInput = useCallback(
			(val: string) => {
				if (val === inputRef.current) return;
				inputUndoHistoryRef.current.push(inputRef.current);
				if (inputUndoHistoryRef.current.length > 100) {
					inputUndoHistoryRef.current.shift();
				}
				inputRedoHistoryRef.current = [];
				inputRef.current = val;
				setInputRaw(val);
				saveStoredInput(paneId, val);
			},
			[paneId]
		);
		const undoInput = useCallback(() => {
			const previous = inputUndoHistoryRef.current.pop();
			if (previous === undefined) return false;
			inputRedoHistoryRef.current.push(inputRef.current);
			inputRef.current = previous;
			setInputRaw(previous);
			saveStoredInput(paneId, previous);
			return true;
		}, [paneId]);
		const redoInput = useCallback(() => {
			const next = inputRedoHistoryRef.current.pop();
			if (next === undefined) return false;
			inputUndoHistoryRef.current.push(inputRef.current);
			inputRef.current = next;
			setInputRaw(next);
			saveStoredInput(paneId, next);
			return true;
		}, [paneId]);
		const restoreInputSelection = useCallback((target: HTMLTextAreaElement) => {
			requestAnimationFrame(() => {
				target.focus();
				const end = target.value.length;
				target.setSelectionRange(end, end);
			});
		}, []);

		useEffect(() => {
			inputUndoHistoryRef.current = [];
			inputRedoHistoryRef.current = [];
			const storedInput = loadStoredInput(paneId);
			inputRef.current = storedInput;
			setInputRaw(storedInput);
		}, [paneId]);
		useEffect(() => {
			inputRef.current = input;
		}, [input]);

		const cwdList = useMemo(() => (cwd ? [cwd] : []), [cwd]);
		const { projects: gitProjects } = useGitStatus(cwdList);
		const gitBranch = gitProjects[0]?.branch ?? null;

		const agentKindOptions = useMemo(
			() => [
				{
					id: "claude" as const,
					label: "Claude",
					icon: getAgentIcon("claude", 11),
				},
				{
					id: "codex" as const,
					label: "Codex",
					icon: getAgentIcon("codex", 11),
				},
			],
			[]
		);

		// Track when agent kind switches so the next message includes prior context
		const prevAgentKindRef = useRef(agentKind);
		const agentKindJustChanged = useRef(false);
		useEffect(() => {
			if (prevAgentKindRef.current !== agentKind) {
				prevAgentKindRef.current = agentKind;
				agentKindJustChanged.current = true;
				clearStoredSessionId(paneId);
			}
		}, [agentKind, paneId]);
		useEffect(() => {
			const definition = getAgentDefinition(agentKind);
			if (!definition.models.length) return;
			if (definition.models.some((model) => model.id === selectedModel)) return;
			const nextModel = definition.defaultModel;
			setSelectedModel(nextModel);
			saveStoredModel(paneId, nextModel);
		}, [agentKind, paneId, selectedModel]);

		const [chatUiState, setChatUiState] = useState<{
			isLoading: boolean;
			status: string;
			startTime: number | null;
			expandedTools: Set<string>;
			liveActivities: ToolActivity[];
		}>({
			isLoading: false,
			status: "idle",
			startTime: null,
			expandedTools: new Set(),
			liveActivities: [],
		});
		const chatUiStateRef = useRef(chatUiState);
		chatUiStateRef.current = chatUiState;
		const { isLoading, status, expandedTools, liveActivities } = chatUiState;
		const setLoadingState = useCallback(
			(
				v:
					| { isLoading: boolean; status: string; startTime: number | null }
					| ((prev: {
							isLoading: boolean;
							status: string;
							startTime: number | null;
					  }) => {
							isLoading: boolean;
							status: string;
							startTime: number | null;
					  })
			) => {
				const prev = chatUiStateRef.current;
				const patch = typeof v === "function" ? v(prev) : v;
				const next = { ...prev, ...patch };
				chatUiStateRef.current = next;
				setChatUiState(next);
				if (prev.status !== next.status) {
					onStatusChange?.(paneId, next.status);
				}
			},
			[onStatusChange, paneId]
		);
		const setExpandedTools = useCallback(
			(v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
				setChatUiState((prev) => ({
					...prev,
					expandedTools: typeof v === "function" ? v(prev.expandedTools) : v,
				}));
			},
			[]
		);
		const [, setCommandMenu] = useState<{
			show: boolean;
			selectedIdx: number;
			position: {
				top: number;
				left: number;
				width: number;
				maxHeight: number;
			} | null;
		}>({ show: false, selectedIdx: 0, position: null });
		const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>(() => {
			return loadStoredCheckpoints<CheckpointInfo>(paneId);
		});
		const checkpointsRef = useRef(checkpoints);
		checkpointsRef.current = checkpoints;
		const scrollRef = useRef<HTMLDivElement>(null);
		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const highlightOverlayRef = useRef<HTMLDivElement>(null);
		const inputContainerRef = useRef<HTMLDivElement>(null);
		const currentAssistantRef = useRef<string | null>(null);
		const currentToolRef = useRef<string | null>(null);
		const hasStreamedRef = useRef(false);
		const containerRef = useRef<HTMLDivElement>(null);
		const [isAtBottom, setIsAtBottom] = useState(true);
		const currentBtwRef = useRef<string | null>(null);
		const {
			isDragOver,
			setIsDragOver,
			attachedImages,
			queueRef,
			queuedMessages,
			setQueuedMessages,
			queueMessage,
			shiftQueuedMessage,
			removeQueuedMessage,
			updateQueuedMessage,
			editingQueueId,
			setEditingQueueId,
			editingQueueText,
			setEditingQueueText,
			mdPreview,
			setMdPreview,
			handleMdFileClick,
			attachImage,
			removeAttachedImage,
			clearAttachedImages,
			handleDrop,
			handlePaste,
		} = useAgentChatComposerState();

		const handleScroll = useCallback(() => {
			const el = scrollRef.current;
			if (!el) return;
			const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
			setIsAtBottom(atBottom);
		}, []);

		const scrollToBottom = useCallback(() => {
			const el = scrollRef.current;
			if (!el) return;
			el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		}, []);

		useEffect(() => {
			if (!isSelected) return;
			const onKeyDown = (e: KeyboardEvent) => {
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
			};
			window.addEventListener("keydown", onKeyDown);
			return () => window.removeEventListener("keydown", onKeyDown);
		}, [isSelected, isAtBottom, scrollToBottom]);

		useEffect(() => {
			requestAnimationFrame(() => textareaRef.current?.focus());
		}, []);

		const appendLocalMessages = useCallback(
			(pending: Array<Pick<ChatMessage, "role" | "content" | "images">>) => {
				if (pending.length === 0) return;
				setMessages((prev) =>
					trimMessages([
						...prev,
						...pending.map((msg) => ({
							id: nextId(),
							role: msg.role,
							content: msg.content,
							images: msg.images,
						})),
					])
				);
			},
			[setMessages]
		);
		const { prompts: localPrompts, incrementUsage: incrementLocalUsage } =
			usePrompts();
		const allCommands = useMemo<SlashCommand[]>(() => {
			const libraryCommands: SlashCommand[] = localPrompts.map((p) => ({
				id: p._id,
				name: p.command,
				description: p.description,
				action: "send" as const,
				promptTemplate: p.promptTemplate,
				category: p.category,
				isFromLibrary: true,
			}));
			const nativeCommands: SlashCommand[] = getAgentDefinition(
				agentKind
			).nativeSlashCommands.map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
				action: "send",
				isLocalCommand: true,
			}));
			const deduped = new Map<string, SlashCommand>();
			for (const cmd of [
				...LOCAL_COMMANDS,
				...libraryCommands,
				...nativeCommands,
			]) {
				const key = cmd.name.toLowerCase();
				if (!deduped.has(key)) deduped.set(key, cmd);
			}
			return [...deduped.values()];
		}, [agentKind, localPrompts]);
		const {
			fileMenu,
			setFileMenu,
			fileResults,
			slashMenu,
			setSlashMenu,
			filteredCommands,
			showCommands,
			handleInputForFileMenu,
			handleInputForSlashMenu,
			selectCommand,
			selectFile,
		} = useAgentChatMenus({
			cwd,
			input,
			setInput,
			allCommands,
			textareaRef,
			inputContainerRef,
			containerRef,
		});
		const sendToServer = useCallback(
			(text: string) => {
				setLoadingState({
					isLoading: true,
					status: "thinking",
					startTime: Date.now(),
				});
				currentAssistantRef.current = null;

				let prompt = text;
				const sessionId = loadStoredSessionId(paneId);
				if (!sessionId && (cwd || (referencePaths?.length ?? 0) > 0)) {
					const workspaceLines = [
						"You are working in a multi-directory workspace.",
						cwd
							? `Primary working directory (use this as the execution root unless the user says otherwise): ${cwd}`
							: null,
						referencePaths?.length
							? `Additional reference directories available in this workspace:\n${referencePaths.map((path) => `- ${path}`).join("\n")}`
							: null,
						referencePaths?.length
							? "The additional directories are supporting context. Read and reference them when relevant, but treat the primary working directory as the default root."
							: null,
					]
						.filter(Boolean)
						.join("\n\n");
					prompt = `<workspace-context>\n${workspaceLines}\n</workspace-context>\n\n${prompt}`;
				}
				// On first message after switching agent kind, prepend prior conversation context
				if (agentKindJustChanged.current) {
					agentKindJustChanged.current = false;
					const history = messagesRef.current;
					if (history.length > 0) {
						const contextLines: string[] = [];
						// Take the last ~20 messages, skip tool/system noise
						const recent = history.slice(-20);
						for (const msg of recent) {
							if (msg.role === "user") {
								contextLines.push(`User: ${msg.content.slice(0, 500)}`);
							} else if (msg.role === "assistant" && msg.content) {
								contextLines.push(`Assistant: ${msg.content.slice(0, 500)}`);
							}
						}
						if (contextLines.length > 0) {
							prompt = `<prior-conversation-context>\nThe following is a summary of the prior conversation in this chat session (from a different model). Use it as context for the request below.\n\n${contextLines.join("\n\n")}\n</prior-conversation-context>\n\n${text}`;
						}
					}
				}

				wsClient.send({
					type: "chat:send",
					paneId,
					text: prompt,
					cwd,
					sessionId,
					agentKind,
					model: selectedModel || getDefaultModel(agentKind),
					reasoningLevel:
						agentKind === "codex" ? selectedReasoningLevel : undefined,
				});
			},
			[
				paneId,
				cwd,
				referencePaths,
				agentKind,
				selectedModel,
				selectedReasoningLevel,
				getDefaultModel,
				setLoadingState,
			]
		);
		const extractToolActivitiesForHandle = useCallback(
			(): ToolActivity[] => extractToolActivities(messagesRef.current),
			[]
		);

		const stopGeneration = useCallback(() => {
			wsClient.send({ type: "chat:stop", paneId });
			setLoadingState({ isLoading: false, status: "idle", startTime: null });
			setMessages((prev) =>
				trimMessages([
					...prev,
					{ id: nextId(), role: "system", content: "Generation stopped" },
				])
			);
		}, [paneId, setLoadingState, setMessages]);

		useImperativeHandle(
			ref,
			() => ({
				sendMessage: (text: string) => {
					if (!text.trim()) return;
					if (isLoading) {
						queueMessage(text.trim(), text.trim());
					} else {
						appendLocalMessages([{ role: "user", content: text.trim() }]);
						sendToServer(text.trim());
					}
				},
				sendMessageWithImages: (text: string, images?: string[]) => {
					if (!text.trim()) return;
					if (isLoading) {
						queueMessage(text.trim(), text.trim(), images);
					} else {
						appendLocalMessages([
							{ role: "user", content: text.trim(), images },
						]);
						sendToServer(text.trim());
					}
				},
				getStatus: () => status,
				focusInput: (atEnd?: boolean) => {
					const ta = textareaRef.current;
					if (ta) {
						ta.focus();
						if (atEnd) {
							const len = ta.value.length;
							ta.setSelectionRange(len, len);
						}
					}
				},
				getToolActivities: extractToolActivitiesForHandle,
				getQueuedCount: () => queuedMessages.length,
				getQueuedMessages: () =>
					queuedMessages.map((q) => ({
						id: q.id,
						text: q.text,
						displayText: q.displayText,
						images: q.images,
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
				appendLocalMessages,
				attachImage,
				isLoading,
				queueMessage,
				removeAttachedImage,
				removeQueuedMessage,
				status,
				sendToServer,
				extractToolActivitiesForHandle,
				queuedMessages,
				stopGeneration,
				attachedImages,
				updateQueuedMessage,
			]
		);

		useEffect(() => {
			const cleanup = wsClient.subscribe(paneId, (msg: any) => {
				if (msg.type === "chat:event") {
					handleChatEventRef.current(msg.event);
					if (msg.event?.session_id) {
						saveStoredSessionId(paneId, msg.event.session_id);
					}
				} else if (msg.type === "chat:session") {
					if (msg.sessionId) {
						saveStoredSessionId(paneId, msg.sessionId);
					}
				} else if (msg.type === "chat:done") {
					const updated = trimMessages(
						messagesRef.current.map((m) =>
							m.isStreaming ? { ...m, isStreaming: false } : m
						)
					);
					saveStoredMessages(paneId, updated);
					setMessages(updated);
					const ids = new Set(updated.map((m) => m.id));
					setChatUiState((prev) => {
						const pruned = new Set<string>();
						for (const id of prev.expandedTools) {
							if (ids.has(id)) pruned.add(id);
						}
						return {
							isLoading: false,
							status: "idle",
							startTime: null,
							expandedTools:
								pruned.size === prev.expandedTools.size
									? prev.expandedTools
									: pruned,
							liveActivities: [],
						};
					});
					currentAssistantRef.current = null;
					currentToolRef.current = null;
					hasStreamedRef.current = false;
					wsClient.send({ type: "chat:reconnect", paneId });
					const next = shiftQueuedMessage();
					if (next) {
						appendLocalMessages([
							{
								role: "user",
								content: next.displayText,
								images: next.images,
							},
						]);
						sendToServer(next.text);
					}
				} else if (msg.type === "chat:user_message") {
					setChatUiState((prev) => ({ ...prev, liveActivities: [] }));
					setLoadingState({
						isLoading: true,
						status: "thinking",
						startTime: Date.now(),
					});
					currentAssistantRef.current = null;
				} else if (msg.type === "chat:error") {
					setMessages((prev) => {
						const updated = trimMessages([
							...prev,
							{ id: nextId(), role: "system", content: msg.error },
						]);
						saveStoredMessages(paneId, updated);
						return updated;
					});
					setLoadingState({
						isLoading: false,
						status: "error",
						startTime: null,
					});
					const next = shiftQueuedMessage();
					if (next) {
						appendLocalMessages([
							{
								role: "user",
								content: next.displayText,
								images: next.images,
							},
						]);
						sendToServer(next.text);
					}
				} else if (msg.type === "chat:system") {
					setMessages((prev) => {
						const updated = trimMessages([
							...prev,
							{ id: nextId(), role: "system", content: msg.message },
						]);
						saveStoredMessages(paneId, updated);
						return updated;
					});
				} else if (msg.type === "chat:status") {
					setLoadingState((prev) => ({
						isLoading: msg.isLoading ?? prev.isLoading,
						status: msg.status ?? prev.status,
						startTime: prev.startTime ?? Date.now(),
					}));
				} else if (msg.type === "chat:activity" && msg.activity) {
					setChatUiState((prev) => {
						const nextActivity: ToolActivity = {
							id: `${msg.activity.toolName}-${prev.liveActivities.length}`,
							toolName: msg.activity.toolName,
							summary: msg.activity.summary,
							isStreaming: msg.activity.isStreaming ?? true,
						};
						const last = prev.liveActivities[prev.liveActivities.length - 1];
						if (
							last &&
							last.toolName === nextActivity.toolName &&
							last.summary === nextActivity.summary
						) {
							return prev;
						}
						return {
							...prev,
							liveActivities: [...prev.liveActivities, nextActivity].slice(-12),
						};
					});
				} else if (msg.type === "chat:sync") {
					const serverMessages: ChatMessage[] = msg.messages;
					if (serverMessages.length === 0) return;
					const currentMessages = messagesRef.current;
					const shouldSkipSync =
						serverMessages.length < currentMessages.length && !msg.isStreaming;

					if (shouldSkipSync) {
						return;
					}
					setMessages((prev) =>
						trimMessages(mergeSyncedMessages(prev, serverMessages))
					);
					saveStoredMessages(paneId, serverMessages);
					if (msg.isStreaming) {
						setLoadingState({
							isLoading: true,
							status: "responding",
							startTime: Date.now(),
						});
						const lastAssistant = serverMessages.findLast?.(
							(m: ChatMessage) => m.isStreaming && m.role === "assistant"
						);
						if (lastAssistant) currentAssistantRef.current = lastAssistant.id;
						const lastTool = serverMessages.findLast?.(
							(m: ChatMessage) => m.isStreaming && m.role === "tool"
						);
						if (lastTool) currentToolRef.current = lastTool.id;
					} else {
						setLoadingState((prev) => {
							if (prev.isLoading) return prev; // Don't interrupt active loading
							return {
								isLoading: false,
								status: "idle",
								startTime: null,
							};
						});
						setChatUiState((prev) => ({ ...prev, liveActivities: [] }));
						currentAssistantRef.current = null;
						currentToolRef.current = null;
						hasStreamedRef.current = false;
					}
				} else if (msg.type === "chat:btw:start") {
					const id = nextId();
					currentBtwRef.current = id;
					setMessages((prev) =>
						trimMessages([
							...prev,
							{
								id,
								role: "btw",
								content: "",
								isStreaming: true,
								btwQuestion: msg.question,
							},
						])
					);
				} else if (msg.type === "chat:btw:delta") {
					const targetId = currentBtwRef.current;
					if (targetId) {
						setMessages((prev) =>
							appendMessageContent(prev, targetId, msg.text)
						);
					}
				} else if (msg.type === "chat:btw:done") {
					const targetId = currentBtwRef.current;
					currentBtwRef.current = null;
					if (targetId) {
						setMessages((prev) => {
							const updated = patchMessageById(prev, targetId, {
								content: msg.answer,
								isStreaming: false,
							});
							saveStoredMessages(paneId, updated);
							return updated;
						});
					}
				} else if (
					msg.type === "checkpoint:finalized" &&
					msg.changedFileCount > 0
				) {
					setCheckpoints((prev) => {
						const msgs = messagesRef.current;
						const lastMsg =
							msgs.findLast?.(
								(m) => m.role === "assistant" && !m.isStreaming
							) ?? msgs.findLast?.((m) => m.role === "assistant");
						if (!lastMsg) return prev; // no assistant message at all — skip
						if (prev.some((c) => c.afterMessageId === lastMsg.id)) return prev;
						const updated = [
							...prev,
							{
								id: msg.checkpointId,
								timestamp: Date.now(),
								changedFileCount: msg.changedFileCount,
								changedFiles: msg.changedFiles,
								reverted: false,
								afterMessageId: lastMsg.id,
							},
						];
						saveStoredCheckpoints(paneId, updated);
						return updated;
					});
				} else if (msg.type === "checkpoint:reverted") {
					setCheckpoints((prev) => {
						const updated = prev.map((cp) =>
							cp.id === msg.checkpointId ? { ...cp, reverted: true } : cp
						);
						saveStoredCheckpoints(paneId, updated);
						return updated;
					});
					setMessages((prev) =>
						trimMessages([
							...prev,
							{
								id: nextId(),
								role: "system",
								content: `Reverted ${msg.restoredFiles?.length ?? 0} file(s) to checkpoint`,
							},
						])
					);
				} else if (msg.type === "checkpoint:error") {
					setMessages((prev) =>
						trimMessages([
							...prev,
							{
								id: nextId(),
								role: "system",
								content: `Revert failed: ${msg.error}`,
							},
						])
					);
				}
			});
			const reconnectChat = () => {
				wsClient.send({ type: "chat:reconnect", paneId });
			};
			reconnectChat();
			const cleanupReconnect = wsClient.onReconnect(reconnectChat);
			return () => {
				cleanupReconnect();
				cleanup();
			};
		}, [
			paneId,
			appendLocalMessages,
			sendToServer,
			setLoadingState,
			setMessages,
			shiftQueuedMessage,
		]);

		function handleChatEvent(event: any) {
			if (!event?.type) return;

			if (event.type === "assistant") {
				const msg = event.message;
				if (!msg?.content) return;
				if (hasStreamedRef.current) return;
				for (const block of msg.content) {
					if (block.type === "text" && block.text) {
						setLoadingState((prev) => ({ ...prev, status: "responding" }));
						if (currentAssistantRef.current) {
							const targetId = currentAssistantRef.current;
							setMessages((prev) => {
								const updated = patchMessageById(
									prev,
									targetId,
									{
										content: block.text,
										isStreaming: !msg.stop_reason,
									},
									false
								);
								return updated;
							});
						} else {
							const id = nextId();
							currentAssistantRef.current = id;
							setMessages((prev) =>
								trimMessages([
									...prev,
									{
										id,
										role: "assistant",
										content: block.text,
										isStreaming: !msg.stop_reason,
									},
								])
							);
						}
					} else if (block.type === "tool_use") {
						const id = nextId();
						currentAssistantRef.current = null;
						currentToolRef.current = id;
						setLoadingState((prev) => ({
							...prev,
							status: `tool:${block.name}`,
						}));
						const inputStr =
							typeof block.input === "string"
								? block.input
								: JSON.stringify(block.input, null, 2);
						setMessages((prev) =>
							trimMessages([
								...prev,
								{
									id,
									role: "tool",
									content: inputStr,
									toolName: block.name,
									isStreaming: true,
								},
							])
						);
					}
				}
			} else if (event.type === "content_block_start") {
				hasStreamedRef.current = true;
				const block = event.content_block;
				if (block?.type === "text") {
					const id = nextId();
					currentAssistantRef.current = id;
					setLoadingState((prev) => ({ ...prev, status: "responding" }));
					setMessages((prev) =>
						addMessage(prev, {
							id,
							role: "assistant",
							content: block.text || "",
							isStreaming: true,
						})
					);
				} else if (block?.type === "tool_use") {
					currentAssistantRef.current = null;
					const id = nextId();
					currentToolRef.current = id;
					setLoadingState((prev) => ({
						...prev,
						status: `tool:${block.name}`,
					}));
					setMessages((prev) =>
						addMessage(prev, {
							id,
							role: "tool",
							content: "",
							toolName: block.name,
							isStreaming: true,
						})
					);
				}
			} else if (event.type === "content_block_delta") {
				const delta = event.delta;
				if (
					delta?.type === "text_delta" &&
					delta.text &&
					currentAssistantRef.current
				) {
					const targetId = currentAssistantRef.current;
					setMessages((prev) =>
						appendMessageContent(prev, targetId, delta.text)
					);
				} else if (
					delta?.type === "input_json_delta" &&
					delta.partial_json &&
					currentToolRef.current
				) {
					const targetId = currentToolRef.current;
					setMessages((prev) =>
						appendMessageContent(prev, targetId, delta.partial_json)
					);
				}
			} else if (event.type === "content_block_stop") {
				setMessages((prev) => {
					let updated = prev.slice();
					let changed = false;
					if (currentAssistantRef.current) {
						const targetId = currentAssistantRef.current;
						const next = patchMessageById(updated, targetId, {
							isStreaming: false,
						});
						changed = next !== updated || changed;
						updated = next;
					}
					if (currentToolRef.current) {
						const targetId = currentToolRef.current;
						const next = patchMessageById(updated, targetId, {
							isStreaming: false,
						});
						changed = next !== updated || changed;
						updated = next;
					}
					currentAssistantRef.current = null;
					currentToolRef.current = null;
					if (changed) {
						updated = trimMessages(updated);
					}
					return changed ? updated : prev;
				});
			} else if (event.type === "result") {
				if (event.result) {
					setLoadingState((prev) => ({ ...prev, status: "responding" }));
					if (currentAssistantRef.current) {
						const targetId = currentAssistantRef.current;
						setMessages((prev) => {
							const updated = patchMessageById(
								prev,
								targetId,
								{ content: event.result, isStreaming: false },
								false
							);
							if (updated === prev) {
								return trimMessages([
									...prev,
									{ id: nextId(), role: "assistant", content: event.result },
								]);
							}
							return updated;
						});
						currentAssistantRef.current = null;
					} else {
						setMessages((prev) => {
							const last = prev[prev.length - 1];
							if (last?.role === "assistant" && last.content === event.result)
								return prev;
							return trimMessages([
								...prev,
								{ id: nextId(), role: "assistant", content: event.result },
							]);
						});
					}
				}
			}
		}
		const handleChatEventRef = useRef(handleChatEvent);
		handleChatEventRef.current = handleChatEvent;

		useEffect(() => {
			const ta = textareaRef.current;
			if (!ta) return;
			const width = ta.clientWidth - 32;
			if (width > 0 && input) {
				const measured = measureTextareaHeight(
					input,
					width,
					"13px Geist, -apple-system, system-ui, sans-serif",
					20
				);
				const target = Math.min(Math.max(measured, 20), 120);
				ta.style.height = `${target}px`;
			} else {
				ta.style.height = "20px";
			}
			if (highlightOverlayRef.current && ta) {
				highlightOverlayRef.current.style.transform = `translateY(-${ta.scrollTop}px)`;
			}
		}, [input]);

		const revertCheckpoint = useCallback(
			(checkpointId: string) => {
				wsClient.send({ type: "checkpoint:revert", paneId, checkpointId });
			},
			[paneId]
		);

		const executeCommand = useCallback(
			(cmd: SlashCommand, args?: string) => {
				setCommandMenu((prev) => ({ ...prev, show: false }));
				setInput("");
				if (cmd.name === "btw") {
					const question = (args || "").trim();
					if (!question) {
						setMessages((prev) =>
							trimMessages([
								...prev,
								{
									id: nextId(),
									role: "system",
									content: "Usage: /btw <question>",
								},
							])
						);
						return;
					}
					setMessages((prev) =>
						trimMessages([
							...prev,
							{ id: nextId(), role: "user", content: `/btw ${question}` },
						])
					);
					wsClient.send({ type: "chat:btw", paneId, text: question, cwd });
					return;
				}

				if (cmd.action === "local") {
					if (cmd.name === "clear") {
						setMessages([]);
						clearAgentChatMessages(paneId);
						setCheckpoints([]);
						clearStoredCheckpoints(paneId);
						setMessages([
							{ id: nextId(), role: "system", content: "Chat cleared" },
						]);
					} else if (cmd.name === "help") {
						const helpText = allCommands
							.map((c) => `/${c.name} - ${c.description}`)
							.join("\n");
						setMessages((prev) =>
							trimMessages([
								...prev,
								{ id: nextId(), role: "system", content: helpText },
							])
						);
					}
				} else {
					const prompt = getCommandPrompt(cmd, args);
					const displayText = getCommandDisplayText(cmd, args);
					if (cmd.id) {
						incrementLocalUsage(cmd.id).catch(() => {});
					}

					if (isLoading) {
						queueMessage(prompt, displayText);
					} else {
						appendLocalMessages([
							{ role: "user", content: displayText },
							{
								role: "system",
								content: `Running /${cmd.name}...`,
							},
						]);
						sendToServer(prompt);
					}
				}
			},
			[
				appendLocalMessages,
				isLoading,
				allCommands,
				incrementLocalUsage,
				queueMessage,
				cwd,
				paneId,
				sendToServer,
				setInput,
				setMessages,
			]
		);

		const sendMessage = useCallback(() => {
			const text = input.trim();
			if (!text && attachedImages.length === 0) return;
			if (text.startsWith("/") && !text.includes(" ")) {
				const cmdName = text.slice(1).toLowerCase();
				const cmd = allCommands.find((c) => c.name.toLowerCase() === cmdName);
				if (cmd) {
					executeCommand(cmd, undefined);
					return;
				}
			}
			const imagePaths = attachedImages.map((img) => img.path);

			const { expandedText, usedCommandIds } = expandInlineCommandPrompts(
				text,
				allCommands
			);
			usedCommandIds.forEach((id) => {
				incrementLocalUsage(id).catch(() => {});
			});
			const displayText =
				text || `Attached image${attachedImages.length > 1 ? "s" : ""}`;

			const fullText =
				imagePaths.length > 0
					? `${expandedText}${expandedText ? "\n\n" : ""}Here are the images at these paths:\n${imagePaths.join("\n")}`
					: expandedText;

			setInput("");
			setSlashMenu((prev) => ({ ...prev, show: false }));
			setFileMenu((prev) => ({ ...prev, show: false }));
			clearAttachedImages();
			if (textareaRef.current) textareaRef.current.style.height = "20px";

			if (isLoading) {
				queueMessage(fullText, displayText, imagePaths);
			} else {
				appendLocalMessages([
					{
						role: "user",
						content: displayText,
						images: imagePaths.length > 0 ? imagePaths : undefined,
					},
				]);
				sendToServer(fullText);
			}
		}, [
			input,
			isLoading,
			executeCommand,
			attachedImages,
			appendLocalMessages,
			queueMessage,
			allCommands,
			incrementLocalUsage,
			sendToServer,
			clearAttachedImages,
			setInput,
			setFileMenu,
			setSlashMenu,
		]);

		const handleKeyDown = useCallback(
			(e: React.KeyboardEvent) => {
				const isUndoShortcut =
					(e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z";
				const isRedoShortcut =
					(e.metaKey || e.ctrlKey) &&
					!e.altKey &&
					(e.key.toLowerCase() === "y" ||
						(e.shiftKey && e.key.toLowerCase() === "z"));
				if (isUndoShortcut || isRedoShortcut) {
					const restored = isRedoShortcut ? redoInput() : undoInput();
					if (restored) {
						e.preventDefault();
						restoreInputSelection(e.currentTarget as HTMLTextAreaElement);
						return;
					}
				}
				if (fileMenu.show && fileResults.length > 0) {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setFileMenu((prev) => ({
							...prev,
							selectedIdx: (prev.selectedIdx + 1) % fileResults.length,
						}));
						return;
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						setFileMenu((prev) => ({
							...prev,
							selectedIdx:
								(prev.selectedIdx - 1 + fileResults.length) %
								fileResults.length,
						}));
						return;
					}
					if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
						e.preventDefault();
						selectFile(fileMenu.selectedIdx);
						return;
					}
					if (e.key === "Escape") {
						e.preventDefault();
						setFileMenu((prev) => ({ ...prev, show: false }));
						return;
					}
				}
				if (showCommands && filteredCommands.length > 0) {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setSlashMenu((prev) => ({
							...prev,
							selectedIdx: (prev.selectedIdx + 1) % filteredCommands.length,
						}));
						return;
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						setSlashMenu((prev) => ({
							...prev,
							selectedIdx:
								(prev.selectedIdx - 1 + filteredCommands.length) %
								filteredCommands.length,
						}));
						return;
					}
					if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
						e.preventDefault();
						selectCommand(slashMenu.selectedIdx);
						return;
					}
					if (e.key === "Escape") {
						e.preventDefault();
						setSlashMenu((prev) => ({ ...prev, show: false }));
						return;
					}
				}

				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					sendMessage();
				}
			},
			[
				sendMessage,
				showCommands,
				filteredCommands,
				slashMenu.selectedIdx,
				selectCommand,
				fileMenu.show,
				fileMenu.selectedIdx,
				fileResults,
				selectFile,
				setFileMenu,
				setSlashMenu,
				undoInput,
				redoInput,
				restoreInputSelection,
			]
		);

		const toggleTool = useCallback(
			(id: string) => {
				setExpandedTools((prev) => {
					const next = new Set(prev);
					next.has(id) ? next.delete(id) : next.add(id);
					return next;
				});
			},
			[setExpandedTools]
		);

		const handleSendMessage = useCallback(
			(text: string) => {
				if (!text.trim()) return;
				if (isLoading) {
					queueMessage(text.trim(), text.trim());
				} else {
					appendLocalMessages([{ role: "user", content: text.trim() }]);
					sendToServer(text.trim());
				}
			},
			[appendLocalMessages, isLoading, queueMessage, sendToServer]
		);

		const handleAgentKindChange = useCallback(
			(nextAgentKind: AgentKind) => {
				changePaneAgentKind(paneId, nextAgentKind);
				clearStoredSessionId(paneId);
				const nextModel = getDefaultModel(nextAgentKind);
				if (nextModel) {
					setSelectedModel(nextModel);
					saveStoredModel(paneId, nextModel);
				}
			},
			[getDefaultModel, paneId]
		);

		const handleModelChange = useCallback(
			(model: string) => {
				setSelectedModel(model);
				saveStoredModel(paneId, model);
				clearStoredSessionId(paneId);
			},
			[paneId]
		);

		const handleReasoningLevelChange = useCallback(
			(reasoningLevel: string) => {
				setSelectedReasoningLevel(reasoningLevel);
				saveStoredReasoningLevel(paneId, reasoningLevel);
				clearStoredSessionId(paneId);
			},
			[paneId]
		);

		return (
			<div
				ref={containerRef}
				className={`flex h-full flex-col transition-all ${isDragOver ? "ring-2 ring-inset ring-blue-500/60" : ""}`}
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragOver(true);
				}}
				onDragLeave={() => setIsDragOver(false)}
				onDrop={handleDrop}
			>
				{!hideHeader && (
					<AgentChatHeader
						paneId={paneId}
						cwd={cwd}
						gitBranch={gitBranch}
						draggable={draggable}
						onDragStart={onDragStart}
						onDragEnd={onDragEnd}
						onClose={onClose}
						sessions={sessions}
						onSelectSession={onSelectSession}
					/>
				)}
				<div className="relative flex-1 overflow-hidden">
					<div
						ref={scrollRef}
						className="h-full overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-none"
						onScroll={handleScroll}
					>
						{messages.length === 0 &&
							!isLoading &&
							!cwd &&
							(onDirectoryChange || onAddPane) && (
								<div className="absolute inset-0 z-10 flex flex-col">
									<div className="flex-1 flex items-center justify-center">
										<div className="flex flex-col items-center gap-2">
											{onAddPane && <NewSessionButtons onAddPane={onAddPane} />}
										</div>
									</div>
									{onDirectoryChange && (
										<div className="shrink-0 px-3 pb-2">
											<InlineDirectoryPicker
												onSelect={(path) => {
													if (path) onDirectoryChange(paneId, path);
												}}
												onCancel={() => {}}
												multiSelect
												onMultiSelect={(paths) => {
													if (paths.length > 0) {
														onDirectoryChange(
															paneId,
															paths[0]!,
															paths.slice(1)
														);
													}
												}}
											/>
										</div>
									)}
								</div>
							)}
						<ChatMessageList
							messages={messages}
							expandedTools={expandedTools}
							toggleTool={toggleTool}
							checkpoints={checkpoints}
							revertCheckpoint={revertCheckpoint}
							isLoading={isLoading}
							handleSendMessage={handleSendMessage}
							onMdFileClick={handleMdFileClick}
						/>
					</div>
					{!isAtBottom && (
						<button
							type="button"
							onClick={scrollToBottom}
							className="absolute bottom-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-inferay-gray-border bg-inferay-dark-gray shadow-sm transition-opacity hover:bg-inferay-gray"
						>
							<IconArrowDown size={12} className="text-inferay-soft-white" />
						</button>
					)}
				</div>

				<div className="relative shrink-0">
					{/* Solid bg behind content + gradient fade extending above */}
					<div
						className="pointer-events-none absolute left-0 right-0 bottom-0 bg-inferay-black"
						style={{ top: 0 }}
					/>
					<div
						className="pointer-events-none absolute left-0 right-0"
						style={{
							bottom: "100%",
							height: "64px",
							background:
								"linear-gradient(to bottom, transparent 0%, var(--color-inferay-black) 100%)",
						}}
					/>
					<div className="relative z-10">
						<ChatComposer
							statusBar={
								<AgentChatStatusBar
									messages={messages}
									liveActivities={liveActivities}
									isLoading={isLoading}
									status={status}
									onStop={stopGeneration}
								/>
							}
							showInput={showInput}
							agentKind={agentKind}
							agentKindOptions={agentKindOptions}
							model={selectedModel}
							reasoningLevel={selectedReasoningLevel}
							onAgentKindChange={handleAgentKindChange}
							onModelChange={handleModelChange}
							onReasoningLevelChange={handleReasoningLevelChange}
							input={input}
							setInput={setInput}
							isLoading={isLoading}
							attachedImages={attachedImages}
							removeAttachedImage={removeAttachedImage}
							attachImage={attachImage}
							queuedMessages={queuedMessages}
							editingQueueId={editingQueueId}
							setEditingQueueId={setEditingQueueId}
							editingQueueText={editingQueueText}
							setEditingQueueText={setEditingQueueText}
							queueRef={queueRef}
							setQueuedMessages={setQueuedMessages}
							fileMenu={fileMenu}
							setFileMenu={setFileMenu}
							fileResults={fileResults}
							selectFile={selectFile}
							slashMenu={slashMenu}
							setSlashMenu={setSlashMenu}
							showCommands={showCommands}
							filteredCommands={filteredCommands}
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
						/>
					</div>
				</div>
			</div>
		);
	}
);
