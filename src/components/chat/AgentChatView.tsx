import * as stylex from "@stylexjs/stylex";
import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import {
	CODEX_REASONING_LEVELS,
	getAgentDefinition,
	loadDefaultChatSettings,
} from "../../features/agents/agents.ts";
import { useGitStatus } from "../../features/git/useGitStatus.ts";
import { usePrompts } from "../../features/prompts/usePrompts.ts";
import {
	type AgentKind,
	changePaneAgentKind,
} from "../../features/terminal/terminal-utils.ts";
import { hasId, hasRole, noop } from "../../lib/data.ts";
import { postJson } from "../../lib/fetch-json.ts";
import { measureTextareaHeight } from "../../lib/pretext-utils.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { wsClient } from "../../lib/websocket.ts";
import { InlineDirectoryPicker } from "../../pages/Terminal/InlineDirectoryPicker.tsx";
import { color, controlSize, effectValues } from "../../tokens.stylex.ts";
import { IconArrowDown } from "../ui/Icons.tsx";
import { AgentChatHeader } from "./AgentChatHeader.tsx";
import { AgentChatStatusBar } from "./AgentChatStatusBar.tsx";
import {
	type AgentChatSession,
	type AttachedImageInfo,
	appendMessage,
	appendTrimmedMessage,
	type ChatMessage,
	type CheckpointInfo,
	nextId,
	type QueuedMessageInfo,
	type SlashCommand,
	trimMessages,
} from "../../features/chat/agent-chat-shared.ts";
import { getToolBlockInitialContent } from "../../features/chat/chat-stream-events.ts";
import { ChatComposer } from "./ChatComposer.tsx";
import { ChatMessageList } from "./ChatMessageList.tsx";
import {
	clearLiveActivities,
	extractToolActivities,
	hideMenuState,
	markRespondingState,
	markToolState,
	type ToolActivity,
} from "./chat-agent-utils.ts";
import {
	expandInlineCommandPrompts,
	getCommandDisplayText,
	getCommandPrompt,
} from "./chat-command-utils.ts";
import {
	clearAgentChatMessages,
	clearPendingSend,
	clearStoredCheckpoints,
	clearStoredSessionId,
	clearStoredLoadingState,
	loadPendingSend,
	loadPendingWorkspacePaths,
	loadStoredLoadingState,
	loadStoredCheckpoints,
	loadStoredInput,
	loadStoredMessages,
	loadStoredModel,
	loadStoredReasoningLevel,
	loadStoredSessionId,
	loadStoredSummary,
	savePendingWorkspacePaths,
	saveStoredCheckpoints,
	saveStoredInput,
	saveStoredLoadingState,
	saveStoredMessages,
	saveStoredModel,
	saveStoredReasoningLevel,
	saveStoredSessionId,
	saveStoredSummary,
} from "../../features/chat/chat-session-store.ts";
import {
	appendMessageContent,
	mergeSyncedMessages,
	patchMessageById,
} from "./chat-state-utils.ts";
import { useAgentChatComposerState } from "./useAgentChatComposerState.ts";
import { useAgentChatMenus } from "./useAgentChatMenus.ts";
import { useSpeechToText } from "./useSpeechToText.ts";

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
	composerOnly?: boolean;
	composerOnlyOffsetX?: number;
	onExitComposerOnly?: () => void;
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

const TEXTAREA_MEASURE_CHAR_LIMIT = 6000;

export const AgentChatView = forwardRef<AgentChatHandle, AgentChatViewProps>(
	function AgentChatView(
		{
			paneId,
			cwd,
			referencePaths,
			showInput = true,
			agentKind = loadDefaultChatSettings().agentKind,
			onStatusChange,
			hideHeader,
			onClose,
			isSelected,
			draggable,
			onDragStart,
			onDragEnd,
			sessions,
			onSelectSession,
			composerOnly = false,
			composerOnlyOffsetX = 0,
			onExitComposerOnly,
			onDirectoryChange,
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
		const agentDefinition = useMemo(
			() => getAgentDefinition(agentKind),
			[agentKind]
		);
		const effectiveSelectedModel = agentDefinition.models.some(
			hasId.bind(null, selectedModel)
		)
			? selectedModel
			: getDefaultModel(agentKind);
		const [selectedReasoningLevel, setSelectedReasoningLevel] = useState(() => {
			const stored = loadStoredReasoningLevel(paneId);
			const defaults = loadDefaultChatSettings();
			return CODEX_REASONING_LEVELS.some(hasId.bind(null, stored))
				? stored!
				: defaults.reasoningLevel;
		});
		const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const pendingMessageSaveRef = useRef<ChatMessage[] | null>(null);
		const summaryRef = useRef<string | null>(loadStoredSummary(paneId));
		const titleRequestedRef = useRef(false);
		const pendingWorkspacePathsRef = useRef<string[]>([]);
		const getPendingWorkspacePaths = useCallback(() => {
			const paths =
				pendingWorkspacePathsRef.current.length > 0
					? pendingWorkspacePathsRef.current
					: loadPendingWorkspacePaths(paneId);
			return paths.filter(Boolean);
		}, [paneId]);
		const clearPendingWorkspacePaths = useCallback(() => {
			pendingWorkspacePathsRef.current = [];
			savePendingWorkspacePaths(paneId, []);
		}, [paneId]);
		const scheduleMessageSave = useCallback(
			(nextMessages: ChatMessage[]) => {
				if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
				if (nextMessages.some((message) => message.isStreaming)) return;
				pendingMessageSaveRef.current = nextMessages;
				// Generate AI title from first user message (fire-and-forget)
				if (!summaryRef.current && !titleRequestedRef.current) {
					const firstUser = nextMessages.find(hasRole.bind(null, "user"));
					if (firstUser?.content) {
						titleRequestedRef.current = true;
						postJson<{ title?: string }>("/api/generate-title", {
							message: firstUser.content,
						})
							.then((data) => {
								const title = data?.title?.trim();
								if (title) {
									summaryRef.current = title;
									saveStoredSummary(paneId, title);
									window.dispatchEvent(new Event("terminal-shell-change"));
								}
							})
							.catch(noop);
					}
				}
				saveTimerRef.current = setTimeout(() => {
					saveStoredMessages(paneId, nextMessages);
					pendingMessageSaveRef.current = null;
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
				if (pendingMessageSaveRef.current) {
					saveStoredMessages(paneId, pendingMessageSaveRef.current);
				}
			},
			[paneId]
		);
		const [input, setInputRaw] = useState(() => loadStoredInput(paneId));
		const pendingSendConsumedRef = useRef(false);
		const setInput = useCallback(
			(val: string) => {
				setInputRaw(val);
				saveStoredInput(paneId, val);
			},
			[paneId]
		);
		const {
			cancelListening: cancelSpeechListening,
			error: speechError,
			isListening: isSpeechListening,
			isSupported: isSpeechSupported,
			toggleListening: toggleSpeechListening,
		} = useSpeechToText({ value: input, onChange: setInput });

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

		const [chatUiState, setChatUiState] = useState<{
			isLoading: boolean;
			status: string;
			startTime: number | null;
			expandedTools: Set<string>;
			liveActivities: ToolActivity[];
		}>(() => {
			const storedLoading = loadStoredLoadingState(paneId);
			return {
				isLoading: storedLoading?.isLoading ?? false,
				status: storedLoading?.status ?? "idle",
				startTime: storedLoading?.startTime ?? null,
				expandedTools: new Set(),
				liveActivities: [],
			};
		});
		const chatUiStateRef = useRef(chatUiState);
		chatUiStateRef.current = chatUiState;
		const { isLoading, status, startTime, expandedTools, liveActivities } =
			chatUiState;
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
				if (next.isLoading && next.startTime) {
					saveStoredLoadingState(paneId, {
						isLoading: next.isLoading,
						status: next.status,
						startTime: next.startTime,
					});
				} else {
					clearStoredLoadingState(paneId);
				}
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
		const autoFollowRef = useRef(true);
		const programmaticScrollRef = useRef(false);
		const {
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
		} = useAgentChatComposerState(paneId);

		const handleScroll = useCallback(() => {
			const el = scrollRef.current;
			if (!el) return;
			const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			setIsAtBottom(atBottom);
			if (programmaticScrollRef.current) return;
			autoFollowRef.current = atBottom;
		}, []);

		const scrollToBottom = useCallback(
			(behavior: ScrollBehavior = "smooth") => {
				const el = scrollRef.current;
				if (!el) return;
				autoFollowRef.current = true;
				programmaticScrollRef.current = true;
				el.scrollTo({ top: el.scrollHeight, behavior });
				setIsAtBottom(true);
				window.setTimeout(
					() => {
						programmaticScrollRef.current = false;
					},
					behavior === "smooth" ? 260 : 0
				);
			},
			[]
		);

		useLayoutEffect(() => {
			if (!autoFollowRef.current) return;
			const el = scrollRef.current;
			if (!el) return;
			programmaticScrollRef.current = true;
			el.scrollTop = el.scrollHeight;
			setIsAtBottom(true);
			const raf = requestAnimationFrame(() => {
				const current = scrollRef.current;
				if (current) current.scrollTop = current.scrollHeight;
				programmaticScrollRef.current = false;
			});
			return () => cancelAnimationFrame(raf);
		}, [messages, liveActivities, isLoading]);

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
			return listenWindowEvent("keydown", onKeyDown);
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
		const slashCommandNames = useMemo(
			() => allCommands.map((command) => command.name),
			[allCommands]
		);
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
			(
				text: string,
				workspaceOverride?: { cwd?: string; referencePaths?: string[] }
			) => {
				autoFollowRef.current = true;
				setLoadingState({
					isLoading: true,
					status: "thinking",
					startTime: Date.now(),
				});
				currentAssistantRef.current = null;

				const sessionId = loadStoredSessionId(paneId);
				const effectiveCwd = workspaceOverride?.cwd ?? cwd;
				const effectiveReferencePaths =
					workspaceOverride?.referencePaths ?? referencePaths;
				const prefixParts: string[] = [];
				if (
					!sessionId &&
					(effectiveCwd || (effectiveReferencePaths?.length ?? 0) > 0)
				) {
					const workspaceLines = [
						"You are working in a multi-directory workspace.",
						effectiveCwd
							? `Primary working directory (use this as the execution root unless the user says otherwise): ${effectiveCwd}`
							: null,
						effectiveReferencePaths?.length
							? `Additional reference directories available in this workspace:\n${effectiveReferencePaths.map((path) => `- ${path}`).join("\n")}`
							: null,
						effectiveReferencePaths?.length
							? "The additional directories are supporting context. Read and reference them when relevant, but treat the primary working directory as the default root."
							: null,
					]
						.filter(Boolean)
						.join("\n\n");
					prefixParts.push(
						`<workspace-context>\n${workspaceLines}\n</workspace-context>`
					);
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
							prefixParts.push(
								`<prior-conversation-context>\nThe following is a summary of the prior conversation in this chat session (from a different model). Use it as context for the request below.\n\n${contextLines.join("\n\n")}\n</prior-conversation-context>`
							);
						}
					}
				}
				const systemPrefix = prefixParts.length
					? prefixParts.join("\n\n")
					: undefined;

				wsClient.send({
					type: "chat:send",
					paneId,
					text,
					systemPrefix,
					cwd: effectiveCwd,
					referencePaths: effectiveReferencePaths,
					sessionId,
					agentKind,
					model: effectiveSelectedModel || getDefaultModel(agentKind),
					reasoningLevel:
						agentKind === "codex" ? selectedReasoningLevel : undefined,
				});
			},
			[
				paneId,
				cwd,
				referencePaths,
				agentKind,
				effectiveSelectedModel,
				selectedReasoningLevel,
				getDefaultModel,
				setLoadingState,
			]
		);
		const extractToolActivitiesForHandle = useCallback(
			(): ToolActivity[] => extractToolActivities(messagesRef.current),
			[]
		);
		const sendNextQueuedMessage = useCallback(() => {
			const next = shiftQueuedMessage();
			if (!next) return;
			appendLocalMessages([
				{
					role: "user",
					content: next.displayText,
					images: next.images,
				},
			]);
			sendToServer(next.text);
		}, [appendLocalMessages, sendToServer, shiftQueuedMessage]);

		useEffect(() => {
			if (pendingSendConsumedRef.current || isLoading) return;
			const pending = loadPendingSend(paneId).trim();
			if (!pending) return;
			pendingSendConsumedRef.current = true;
			clearPendingSend(paneId);
			setInput("");
			appendLocalMessages([{ role: "user", content: pending }]);
			sendToServer(pending);
		}, [paneId, isLoading, setInput, appendLocalMessages, sendToServer]);

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
					setLoadingState({
						isLoading: false,
						status: "idle",
						startTime: null,
					});
					setChatUiState((prev) => {
						const pruned = new Set<string>();
						for (const id of prev.expandedTools) {
							if (ids.has(id)) pruned.add(id);
						}
						return {
							...prev,
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
					sendNextQueuedMessage();
				} else if (msg.type === "chat:user_message") {
					setChatUiState(clearLiveActivities);
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
					sendNextQueuedMessage();
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
						setChatUiState(clearLiveActivities);
						currentAssistantRef.current = null;
						currentToolRef.current = null;
						hasStreamedRef.current = false;
					}
				} else if (msg.type === "chat:btw:start") {
					const id = nextId();
					currentBtwRef.current = id;
					setMessages(
						appendTrimmedMessage.bind(null, {
							id,
							role: "btw",
							content: "",
							isStreaming: true,
							btwQuestion: msg.question,
						})
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
					setMessages(
						appendTrimmedMessage.bind(null, {
							id: nextId(),
							role: "system",
							content: `Reverted ${msg.restoredFiles?.length ?? 0} file(s) to checkpoint`,
						})
					);
				} else if (msg.type === "checkpoint:error") {
					setMessages(
						appendTrimmedMessage.bind(null, {
							id: nextId(),
							role: "system",
							content: `Revert failed: ${msg.error}`,
						})
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
		}, [paneId, sendNextQueuedMessage, setLoadingState, setMessages]);

		function handleChatEvent(event: any) {
			if (!event?.type) return;

			if (event.type === "assistant") {
				const msg = event.message;
				if (!msg?.content) return;
				if (hasStreamedRef.current) return;
				for (const block of msg.content) {
					if (block.type === "text" && block.text) {
						setLoadingState(markRespondingState);
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
							setMessages(
								appendTrimmedMessage.bind(null, {
									id,
									role: "assistant",
									content: block.text,
									isStreaming: !msg.stop_reason,
								})
							);
						}
					} else if (block.type === "tool_use") {
						const id = nextId();
						currentAssistantRef.current = null;
						currentToolRef.current = id;
						setLoadingState(markToolState.bind(null, block.name));
						const inputStr =
							typeof block.input === "string"
								? block.input
								: JSON.stringify(block.input, null, 2);
						setMessages(
							appendTrimmedMessage.bind(null, {
								id,
								role: "tool",
								content: inputStr,
								toolName: block.name,
								isStreaming: true,
							})
						);
					}
				}
			} else if (event.type === "content_block_start") {
				hasStreamedRef.current = true;
				const block = event.content_block;
				if (block?.type === "text") {
					const id = nextId();
					currentAssistantRef.current = id;
					setLoadingState(markRespondingState);
					setMessages(
						appendMessage.bind(null, {
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
					setLoadingState(markToolState.bind(null, block.name));
					setMessages(
						appendMessage.bind(null, {
							id,
							role: "tool",
							content: getToolBlockInitialContent(block),
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
					setLoadingState(markRespondingState);
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
				const measured =
					input.length > TEXTAREA_MEASURE_CHAR_LIMIT
						? 120
						: measureTextareaHeight(
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
				setCommandMenu(hideMenuState);
				setInput("");
				if (cmd.name === "btw") {
					const question = (args || "").trim();
					if (!question) {
						setMessages(
							appendTrimmedMessage.bind(null, {
								id: nextId(),
								role: "system",
								content: "Usage: /btw <question>",
							})
						);
						return;
					}
					setMessages(
						appendTrimmedMessage.bind(null, {
							id: nextId(),
							role: "user",
							content: `/btw ${question}`,
						})
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
						setMessages(
							appendTrimmedMessage.bind(null, {
								id: nextId(),
								role: "system",
								content: helpText,
							})
						);
					}
				} else {
					const prompt = getCommandPrompt(cmd, args);
					const displayText = getCommandDisplayText(cmd, args);
					if (cmd.id) {
						incrementLocalUsage(cmd.id).catch(noop);
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

		const consumePendingWorkspace = useCallback(() => {
			const pendingWorkspacePaths = getPendingWorkspacePaths();
			const selectedWorkspace =
				!cwd && pendingWorkspacePaths.length > 0
					? {
							cwd: pendingWorkspacePaths[0],
							referencePaths: pendingWorkspacePaths.slice(1),
						}
					: undefined;
			if (selectedWorkspace?.cwd) {
				onDirectoryChange?.(
					paneId,
					selectedWorkspace.cwd,
					selectedWorkspace.referencePaths
				);
				clearPendingWorkspacePaths();
			}
			return selectedWorkspace;
		}, [
			clearPendingWorkspacePaths,
			cwd,
			getPendingWorkspacePaths,
			onDirectoryChange,
			paneId,
		]);

		const sendMessage = useCallback(() => {
			const text = input.trim();
			if (!text && attachedImages.length === 0) return;
			cancelSpeechListening();
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
				incrementLocalUsage(id).catch(noop);
			});
			const displayText =
				text || `Attached image${attachedImages.length > 1 ? "s" : ""}`;

			const fullText =
				imagePaths.length > 0
					? `${expandedText}${expandedText ? "\n\n" : ""}Here are the images at these paths:\n${imagePaths.join("\n")}`
					: expandedText;

			setInput("");
			setSlashMenu(hideMenuState);
			setFileMenu(hideMenuState);
			clearAttachedImages();
			if (textareaRef.current) textareaRef.current.style.height = "20px";

			if (isLoading) {
				queueMessage(fullText, displayText, imagePaths);
			} else {
				const selectedWorkspace = consumePendingWorkspace();
				appendLocalMessages([
					{
						role: "user",
						content: displayText,
						images: imagePaths.length > 0 ? imagePaths : undefined,
					},
				]);
				sendToServer(fullText, selectedWorkspace);
			}
		}, [
			input,
			isLoading,
			executeCommand,
			attachedImages,
			appendLocalMessages,
			consumePendingWorkspace,
			queueMessage,
			allCommands,
			incrementLocalUsage,
			sendToServer,
			clearAttachedImages,
			setInput,
			setFileMenu,
			setSlashMenu,
			cancelSpeechListening,
		]);

		function handleMenuKey<S extends { show: boolean; selectedIdx: number }>(
			e: React.KeyboardEvent,
			count: number,
			setMenu: React.Dispatch<React.SetStateAction<S>>,
			selectIdx: number,
			onSelect: (idx: number) => void
		): boolean {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMenu((prev) => ({
					...prev,
					selectedIdx: (prev.selectedIdx + 1) % count,
				}));
				return true;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMenu((prev) => ({
					...prev,
					selectedIdx: (prev.selectedIdx - 1 + count) % count,
				}));
				return true;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				onSelect(selectIdx);
				return true;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMenu(hideMenuState);
				return true;
			}
			return false;
		}

		const handleKeyDown = useCallback(
			(e: React.KeyboardEvent) => {
				if (
					fileMenu.show &&
					fileResults.length > 0 &&
					handleMenuKey(
						e,
						fileResults.length,
						setFileMenu,
						fileMenu.selectedIdx,
						selectFile
					)
				)
					return;
				if (
					showCommands &&
					filteredCommands.length > 0 &&
					handleMenuKey(
						e,
						filteredCommands.length,
						setSlashMenu,
						slashMenu.selectedIdx,
						selectCommand
					)
				)
					return;

				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					sendMessage();
				} else if (composerOnly && e.key === "Escape") {
					e.preventDefault();
					onExitComposerOnly?.();
				}
			},
			[
				composerOnly,
				sendMessage,
				onExitComposerOnly,
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
					const selectedWorkspace = consumePendingWorkspace();
					appendLocalMessages([{ role: "user", content: text.trim() }]);
					sendToServer(text.trim(), selectedWorkspace);
				}
			},
			[
				appendLocalMessages,
				consumePendingWorkspace,
				isLoading,
				queueMessage,
				sendToServer,
			]
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
				{...stylex.props(styles.root, composerOnly && styles.composerOnlyRoot)}
				style={
					composerOnly
						? {
								left: `calc(50% + ${composerOnlyOffsetX}px)`,
							}
						: undefined
				}
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragOver(true);
				}}
				onDragLeave={() => setIsDragOver(false)}
				onDrop={handleDrop}
			>
				{!hideHeader && !composerOnly && (
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
				{!composerOnly && (
					<div {...stylex.props(styles.messageRegion)}>
						<div
							ref={scrollRef}
							{...stylex.props(styles.scrollArea)}
							onScroll={handleScroll}
						>
							{messages.length === 0 &&
								!isLoading &&
								!cwd &&
								onDirectoryChange && (
									<div {...stylex.props(styles.directoryPickerWrap)}>
										<div {...stylex.props(styles.directoryPickerInner)}>
											<InlineDirectoryPicker
												onSelect={(path) => {
													if (path) onDirectoryChange(paneId, path);
												}}
												multiSelect
												showStartButton={false}
												onSelectionChange={(paths) => {
													pendingWorkspacePathsRef.current = paths;
													savePendingWorkspacePaths(paneId, paths);
												}}
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
									</div>
								)}
							<ChatMessageList
								messages={messages}
								expandedTools={expandedTools}
								toggleTool={toggleTool}
								checkpoints={checkpoints}
								revertCheckpoint={revertCheckpoint}
								isLoading={isLoading}
								startTime={startTime}
								handleSendMessage={handleSendMessage}
								onMdFileClick={handleMdFileClick}
								slashCommandNames={slashCommandNames}
							/>
						</div>
						{!isAtBottom && (
							<button
								type="button"
								onClick={() => scrollToBottom()}
								{...stylex.props(styles.scrollButton)}
							>
								<IconArrowDown size={12} {...stylex.props(styles.scrollIcon)} />
							</button>
						)}
					</div>
				)}

				<div {...stylex.props(styles.composerRegion)}>
					{!composerOnly && (
						<>
							<div
								{...stylex.props(styles.composerBackdrop)}
								style={{ backgroundImage: effectValues.composerBackdrop }}
							/>
							<div
								{...stylex.props(styles.composerFade)}
								style={{ backgroundImage: effectValues.composerFade }}
							/>
						</>
					)}
					<div {...stylex.props(styles.composerContent)}>
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
							model={effectiveSelectedModel}
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
							voiceInput={{
								error: speechError,
								isListening: isSpeechListening,
								isSupported: isSpeechSupported,
								onToggleListening: toggleSpeechListening,
							}}
						/>
					</div>
				</div>
			</div>
		);
	}
);

const styles = stylex.create({
	root: {
		display: "flex",
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
		paddingBottom: controlSize._2,
	},
	directoryPickerInner: {
		maxWidth: "42rem",
		marginInline: "auto",
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
	composerBackdrop: {
		position: "absolute",
		pointerEvents: "none",
		left: 0,
		right: 0,
		bottom: 0,
		top: "-36px",
	},
	composerFade: {
		position: "absolute",
		pointerEvents: "none",
		left: 0,
		right: 0,
		bottom: "100%",
		height: "36px",
	},
	composerContent: {
		position: "relative",
		zIndex: 10,
	},
});
