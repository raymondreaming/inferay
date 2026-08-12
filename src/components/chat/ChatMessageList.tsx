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
} from "octane";
import type React from "react";
import type { CheckpointInfo } from "../../features/chat/agent-chat-shared.ts";
import {
	type CommandSystemMessage,
	parseCommandSystemMessage,
} from "../../features/chat/command-system-message.ts";
import {
	type GoalSystemMessage,
	parseGoalSystemMessage,
} from "../../features/chat/goal-system-message.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { DotMatrixRipple, ThinkingIndicator } from "../ui/DotMatrixLoader.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconChevronDown,
	IconClock,
	IconCopy,
	IconTarget,
} from "../ui/Icons.tsx";
import { GroupedEditDiff, MiniEditDiff } from "./ChatEditDiff.tsx";
import {
	AskUserQuestionCard,
	CopyButton,
	Markdown,
} from "./ChatRichContent.tsx";
import {
	buildRenderItems,
	getEditToolPayload,
	getToolDisplayInfo,
	getToolOutputSummary,
	getToolTrailingOutput,
	type RenderChatMessage,
	type RenderItem,
} from "./chat-message-render-utils.ts";
import { renderTextPills } from "./chat-token-decorators.tsx";

type ChatMessage = RenderChatMessage;

export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
	isAtEnd: () => boolean;
	getDistanceFromEnd: () => number;
};

type ChatRenderRow =
	| RenderItem
	| { type: "thinking"; key: string; startTime: number };

// Virtualizer padding is numeric; keep these in px so scroll-to-end accounts
// for the composer fade instead of hiding the loader under it.
const CHAT_LIST_TOP_PADDING_PX = 16;
const CHAT_LIST_BOTTOM_PADDING_PX = 16;
const CHAT_LIST_INLINE_GUTTER = "clamp(0.75rem, 3vw, 1.25rem)";

function getRowKey(row: ChatRenderRow | undefined, index: number) {
	if (!row) return `row-${index}`;
	if (row.type === "thinking") return row.key;
	if (row.type === "edit-group") {
		return `edit-group:${row.filePath}:${row.edits.map((edit) => edit.id).join(":")}`;
	}
	if (row.type === "tool-group") {
		return `tool-group:${row.tools.map((tool) => tool.id).join(":")}`;
	}
	return row.message.id;
}

function ToolOutputHighlight({
	content,
	showOutput = true,
}: {
	content: string;
	showOutput?: boolean;
}) {
	const summary = getToolOutputSummary(content);
	const trailingOutput = showOutput ? getToolTrailingOutput(content) : "";
	let highlight: unknown;
	if (summary.type === "edit" || summary.type === "file-content") {
		highlight = (
			<>
				<span {...stylex.props(styles.toolMuted)}>{summary.fileName}</span>
				{"\n"}
				<span {...stylex.props(styles.toolAccent)}>{summary.value}</span>
			</>
		);
	} else if (summary.type === "command") {
		highlight = (
			<span {...stylex.props(styles.toolAccent)}>$ {summary.value}</span>
		);
	} else if (summary.type === "pattern") {
		highlight = (
			<span {...stylex.props(styles.toolAccent)}>/{summary.value}/</span>
		);
	} else if (summary.type === "accent") {
		highlight = (
			<span {...stylex.props(styles.toolAccent)}>{summary.value}</span>
		);
	} else if (summary.type === "url") {
		highlight = (
			<a
				href={summary.value}
				target="_blank"
				rel="noopener noreferrer"
				{...stylex.props(styles.toolLink)}
			>
				{summary.value}
			</a>
		);
	} else {
		highlight = summary.value;
	}
	return (
		<>
			{highlight}
			{trailingOutput && (
				<>
					{"\n"}
					{trailingOutput}
				</>
			)}
		</>
	);
}

function goalStatusLabel(status: GoalSystemMessage["status"]) {
	if (status === "active") return "Pursuing Goal";
	if (status === "paused") return "Goal Paused";
	if (status === "complete") return "Goal Achieved";
	if (status === "cleared") return "Goal Cleared";
	return "No Active Goal";
}

function ToolTimeline({
	tools,
	expandedTools,
	onToggle,
}: {
	tools: RenderChatMessage[];
	expandedTools: Set<string>;
	onToggle: (id: string) => void;
}) {
	return (
		<div {...stylex.props(styles.toolTimeline)}>
			{tools.map((tool, index) => {
				const collapsed = !expandedTools.has(tool.id);
				const display = getToolDisplayInfo(tool.toolName, tool.content);
				return (
					<div key={tool.id} {...stylex.props(styles.toolMilestone)}>
						<span
							aria-hidden="true"
							{...stylex.props(
								styles.toolMilestoneNode,
								index === tools.length - 1 && styles.toolMilestoneNodeLast,
							)}
						/>
						<div {...stylex.props(styles.toolMilestoneBody)}>
							<button
								type="button"
								onClick={() => onToggle(tool.id)}
								title={
									collapsed ? "Show command details" : "Hide command details"
								}
								{...stylex.props(styles.toolMilestoneToggle)}
							>
								<span {...stylex.props(styles.toolMilestoneLabel)}>
									{display.label}
								</span>
								{display.detail && (
									<span {...stylex.props(styles.toolMilestoneDetail)}>
										{display.detail}
									</span>
								)}
								<IconChevronDown
									size={8}
									{...stylex.props(
										styles.toolMilestoneChevron,
										collapsed && styles.rotateClosed,
									)}
								/>
							</button>
							{!collapsed && tool.content && (
								<div {...stylex.props(styles.toolOutputWrap)}>
									<pre {...stylex.props(styles.toolOutput)}>
										<ToolOutputHighlight content={tool.content} />
									</pre>
									<div {...stylex.props(styles.toolCopyOverlay)}>
										<CopyButton text={tool.content} />
									</div>
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function GoalSystemCard({ goal }: { goal: GoalSystemMessage }) {
	const turnsLabel =
		typeof goal.turns === "number"
			? `${goal.turns} turn${goal.turns === 1 ? "" : "s"}`
			: null;
	return (
		<div
			{...stylex.props(
				styles.goalCard,
				goal.status === "active" && styles.goalCardActive,
				goal.status === "paused" && styles.goalCardPaused,
				goal.status === "complete" && styles.goalCardComplete,
			)}
		>
			<span
				{...stylex.props(
					styles.goalIconSlot,
					goal.status === "active" && styles.goalIconActive,
					goal.status === "paused" && styles.goalIconPaused,
					goal.status === "complete" && styles.goalIconComplete,
				)}
			>
				{goal.status === "active" ? (
					<DotMatrixRipple
						dotSize={1.35}
						gap={1}
						speed={1.1}
						ariaLabel="Goal running"
					/>
				) : goal.status === "complete" ? (
					<IconCheck size={12} />
				) : goal.status === "paused" ? (
					<IconAlertTriangle size={12} />
				) : (
					<IconTarget size={12} />
				)}
			</span>
			<div {...stylex.props(styles.goalCardBody)}>
				<div {...stylex.props(styles.goalCardHeader)}>
					<span {...stylex.props(styles.goalCardTitle)}>
						{goalStatusLabel(goal.status)}
					</span>
					{turnsLabel && (
						<span {...stylex.props(styles.goalTurns)}>{turnsLabel}</span>
					)}
				</div>
				{goal.objective && (
					<div {...stylex.props(styles.goalObjective)}>{goal.objective}</div>
				)}
				{goal.detail && (
					<div {...stylex.props(styles.goalDetail)}>{goal.detail}</div>
				)}
			</div>
		</div>
	);
}

function CommandSystemCard({ command }: { command: CommandSystemMessage }) {
	const commandLabel = `/${command.name}${command.args ? ` ${command.args}` : ""}`;
	return (
		<div {...stylex.props(styles.goalCard, styles.goalCardActive)}>
			<span {...stylex.props(styles.goalIconSlot, styles.goalIconActive)}>
				<DotMatrixRipple
					dotSize={1.35}
					gap={1}
					speed={1.1}
					ariaLabel="Command running"
				/>
			</span>
			<div {...stylex.props(styles.goalCardBody)}>
				<div {...stylex.props(styles.goalCardHeader)}>
					<span {...stylex.props(styles.goalCardTitle)}>Running Command</span>
				</div>
				<div {...stylex.props(styles.commandObjective)}>{commandLabel}</div>
				{command.description && (
					<div {...stylex.props(styles.goalDetail)}>{command.description}</div>
				)}
			</div>
		</div>
	);
}

function CheckpointMarker({
	checkpoint,
	onRevert,
}: {
	checkpoint: CheckpointInfo;
	onRevert: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div {...stylex.props(styles.checkpointCard)}>
			<div
				{...stylex.props(styles.checkpointHeader)}
				style={{
					borderBottom: expanded
						? "1px solid var(--color-inferay-gray-border)"
						: "none",
				}}
			>
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					{...stylex.props(styles.checkpointToggle)}
				>
					<IconChevronDown
						size={11}
						{...stylex.props(
							styles.checkpointChevron,
							!expanded && styles.rotateClosed,
						)}
					/>
					<IconClock
						size={11}
						{...stylex.props(
							styles.checkpointIcon,
							checkpoint.reverted && styles.revertedIcon,
						)}
					/>
					<span {...stylex.props(styles.checkpointTitle)}>
						{checkpoint.changedFileCount} file
						{checkpoint.changedFileCount !== 1 ? "s" : ""} changed
					</span>
				</button>
				<span {...stylex.props(styles.spacer)} />
				{!checkpoint.reverted ? (
					<button
						type="button"
						onClick={() => onRevert(checkpoint.id)}
						{...stylex.props(styles.undoButton)}
					>
						Undo
					</button>
				) : (
					<span {...stylex.props(styles.revertedLabel)}>reverted</span>
				)}
			</div>
			{expanded && (
				<div {...stylex.props(styles.checkpointFiles)}>
					{checkpoint.changedFiles.map((f) => (
						<div key={f.path} {...stylex.props(styles.checkpointFile)}>
							<span
								style={{
									color:
										f.action === "created"
											? "#22c55e"
											: f.action === "deleted"
												? "#ef4444"
												: "#eab308",
								}}
							>
								{f.action === "created"
									? "+"
									: f.action === "deleted"
										? "-"
										: "~"}
							</span>
							<span {...stylex.props(styles.toolMuted)}>
								{f.path.split("/").pop()}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

const Bubble = memo(function Bubble({
	msg,
	collapsed,
	onToggle,
	onSendMessage,
	onMdFileClick,
	slashCommandNames,
}: {
	msg: ChatMessage;
	collapsed: boolean;
	onToggle: (id: string) => void;
	onSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
}) {
	const [copied, setCopied] = useState(false);
	const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
		},
		[],
	);
	const editPayload = useMemo(
		() =>
			msg.role === "tool" && msg.toolName === "Edit" && msg.content
				? getEditToolPayload(msg.content)
				: null,
		[msg.content, msg.role, msg.toolName],
	);
	const userMessageDisplay = useMemo(() => {
		if (msg.role !== "user") return null;
		let imagePaths = msg.images ?? [];
		let displayContent = msg.content;
		if (
			imagePaths.length === 0 &&
			msg.content.includes("Here are the images at these paths:")
		) {
			const parts = msg.content.split("Here are the images at these paths:\n");
			displayContent = parts[0]?.trim() ?? "";
			const pathLines = parts[1]?.split("\n").filter((p) => p.trim()) ?? [];
			imagePaths = pathLines.filter((p) => p.includes("/.tmp/"));
		}
		return {
			contentNodes: displayContent
				? renderTextPills(displayContent, slashCommandNames)
				: null,
			imagePaths,
		};
	}, [msg.content, msg.images, msg.role, slashCommandNames]);
	const handleCopyMessage = useCallback(() => {
		if (!msg.content) return;
		navigator.clipboard
			.writeText(msg.content)
			.then(() => {
				setCopied(true);
				if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
				copiedTimerRef.current = setTimeout(() => {
					copiedTimerRef.current = null;
					setCopied(false);
				}, 1500);
			})
			.catch(() => setCopied(false));
	}, [msg.content]);

	if (msg.role === "user") {
		const commandMatch = msg.content.match(/^\/([a-zA-Z0-9_-]+)(\s|$)/);
		if (
			commandMatch?.[1] &&
			slashCommandNames.some(
				(command) => command.toLowerCase() === commandMatch[1]!.toLowerCase(),
			)
		) {
			return null;
		}
		if (!userMessageDisplay) return null;
		return (
			<div {...stylex.props(styles.userRow)}>
				<div {...stylex.props(styles.userBubble)}>
					{userMessageDisplay.imagePaths.length > 0 && (
						<div {...stylex.props(styles.userImages)}>
							{userMessageDisplay.imagePaths.map((imgPath, index) => (
								<span
									key={imgPath}
									{...stylex.props(
										styles.userImageFrame,
										index % 2 === 1 && styles.userImageFrameAlt,
									)}
								>
									<img
										src={`/api/file?path=${encodeURIComponent(imgPath)}`}
										alt=""
										{...stylex.props(styles.userImage)}
									/>
								</span>
							))}
						</div>
					)}
					{userMessageDisplay.contentNodes && (
						<p {...stylex.props(styles.userText)}>
							{userMessageDisplay.contentNodes}
						</p>
					)}
				</div>
			</div>
		);
	}

	if (msg.role === "system") {
		const goalMessage = parseGoalSystemMessage(msg.content);
		if (goalMessage) return <GoalSystemCard goal={goalMessage} />;
		const commandMessage = parseCommandSystemMessage(msg.content);
		if (commandMessage) return <CommandSystemCard command={commandMessage} />;
		const runningMatch = msg.content.match(/^Running \/(.+)\.\.\.$/);
		if (runningMatch?.[1]) {
			return (
				<CommandSystemCard
					command={{ type: "inferay.command", name: runningMatch[1] }}
				/>
			);
		}
		return <p {...stylex.props(styles.systemText)}>{msg.content}</p>;
	}

	if (msg.role === "btw") {
		return (
			<div {...stylex.props(styles.btwCard)}>
				<div {...stylex.props(styles.btwHeader)}>
					<span {...stylex.props(styles.btwLabel)}>btw</span>
					{msg.btwQuestion && (
						<span {...stylex.props(styles.btwQuestion)}>
							- {msg.btwQuestion}
						</span>
					)}
				</div>
				<div {...stylex.props(styles.btwBody)}>
					{msg.content ? (
						<Markdown
							text={msg.content}
							onMdFileClick={onMdFileClick}
							streaming={msg.isStreaming}
						/>
					) : msg.isStreaming ? (
						<div {...stylex.props(styles.btwDots)}>
							<span {...stylex.props(styles.smallDot)} />
							<span {...stylex.props(styles.smallDot, styles.dot2)} />
							<span {...stylex.props(styles.smallDot, styles.dot3)} />
						</div>
					) : null}
				</div>
			</div>
		);
	}

	if (msg.role === "tool") {
		if (msg.toolName === "AskUserQuestion") {
			return (
				<AskUserQuestionCard
					content={msg.content}
					isStreaming={msg.isStreaming}
					onSendMessage={onSendMessage}
				/>
			);
		}
		if (editPayload) {
			return (
				<MiniEditDiff
					oldStr={editPayload.oldString}
					newStr={editPayload.newString}
					filePath={editPayload.filePath}
					isStreaming={msg.isStreaming}
				/>
			);
		}
		const display = getToolDisplayInfo(msg.toolName, msg.content);
		return (
			<div>
				<button
					type="button"
					onClick={() => onToggle(msg.id)}
					{...stylex.props(styles.toolToggle)}
				>
					<span {...stylex.props(styles.toolName)}>{display.label}</span>
					{collapsed && display.detail && (
						<span {...stylex.props(styles.toolSummary)}>{display.detail}</span>
					)}
					<IconChevronDown
						size={7}
						{...stylex.props(
							styles.toolMilestoneChevron,
							collapsed && styles.rotateClosed,
						)}
					/>
				</button>
				{!collapsed && msg.content && (
					<div {...stylex.props(styles.toolOutputWrap)}>
						<pre {...stylex.props(styles.toolOutput)}>
							<ToolOutputHighlight content={msg.content} />
						</pre>
						<div {...stylex.props(styles.toolCopyOverlay)}>
							<CopyButton text={msg.content} />
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		<div {...stylex.props(styles.assistantMessage)}>
			<Markdown
				text={msg.content}
				onMdFileClick={onMdFileClick}
				streaming={msg.isStreaming}
			/>
			{!msg.isStreaming && msg.content.trim() ? (
				<div {...stylex.props(styles.messageActionRow)}>
					<button
						type="button"
						onClick={handleCopyMessage}
						title={copied ? "Copied" : "Copy message"}
						aria-label={copied ? "Copied message" : "Copy message"}
						{...stylex.props(
							styles.copyMessageButton,
							copied && styles.copyMessageButtonCopied,
						)}
					>
						{copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
						<span>{copied ? "Copied" : "Copy"}</span>
					</button>
				</div>
			) : null}
		</div>
	);
});

export const ChatMessageList = memo(function ChatMessageList({
	messages,
	scrollElementRef,
	virtualizerControlsRef,
	expandedTools,
	toggleTool,
	checkpoints,
	revertCheckpoint,
	isLoading,
	startTime,
	handleSendMessage,
	onMdFileClick,
	slashCommandNames,
	stickToBottom,
}: {
	messages: ChatMessage[];
	scrollElementRef: React.RefObject<HTMLDivElement | null>;
	virtualizerControlsRef?: React.Ref<ChatVirtualizerControls | null>;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	checkpoints: CheckpointInfo[];
	revertCheckpoint: (id: string) => void;
	isLoading: boolean;
	startTime?: number | null;
	handleSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
	stickToBottom: boolean;
}) {
	const didInitialScrollRef = useRef(false);
	const messageListRef = useRef<HTMLDivElement | null>(null);
	const renderItems = useMemo(() => buildRenderItems(messages), [messages]);
	const renderRows = useMemo<ChatRenderRow[]>(() => {
		if (!isLoading || !startTime) return renderItems;
		return [...renderItems, { type: "thinking", key: "thinking", startTime }];
	}, [isLoading, renderItems, startTime]);
	const lastMessage = messages.at(-1);
	const lastRowChangeKey = lastMessage
		? `${lastMessage.id}:${lastMessage.content.length}:${lastMessage.isStreaming ? 1 : 0}:${renderRows.length}`
		: `${renderRows.at(-1)?.type ?? "none"}:${renderRows.length}`;
	const checkpointsByMessageId = useMemo(() => {
		const byMessageId = new Map<string, CheckpointInfo>();
		for (const checkpoint of checkpoints) {
			if (checkpoint.afterMessageId) {
				byMessageId.set(checkpoint.afterMessageId, checkpoint);
			}
		}
		return byMessageId;
	}, [checkpoints]);
	const pinToBottom = useCallback(
		(behavior: ScrollBehavior = "auto") => {
			const element = scrollElementRef.current;
			if (!element) return;
			element.scrollTo({ top: element.scrollHeight, behavior });
		},
		[scrollElementRef],
	);

	useImperativeHandle(
		virtualizerControlsRef,
		() => ({
			scrollToEnd: (behavior = "smooth") => {
				if (renderRows.length === 0) return;
				pinToBottom(behavior);
			},
			isAtEnd: () => {
				const el = scrollElementRef.current;
				if (!el) return true;
				return el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
			},
			getDistanceFromEnd: () => {
				const el = scrollElementRef.current;
				if (!el) return 0;
				return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
			},
		}),
		[pinToBottom, renderRows.length, scrollElementRef],
	);

	useLayoutEffect(() => {
		if (renderRows.length === 0) return;
		if (!didInitialScrollRef.current) {
			didInitialScrollRef.current = true;
			let raf2 = 0;
			const raf1 = requestAnimationFrame(() => {
				pinToBottom();
				raf2 = requestAnimationFrame(() => {
					pinToBottom();
				});
			});
			return () => {
				cancelAnimationFrame(raf1);
				if (raf2) cancelAnimationFrame(raf2);
			};
		}
		const scrollElement = scrollElementRef.current;
		if (scrollElement) {
			const distanceFromBottom =
				scrollElement.scrollHeight -
				scrollElement.scrollTop -
				scrollElement.clientHeight;
			// Only auto-stick to the bottom when the user is already there.
			// Yanking the viewport mid-read is both jarring and an extra
			// layout/paint we can't afford on every new message.
			if (distanceFromBottom > 120) return;
		}
		const raf = requestAnimationFrame(() => {
			pinToBottom();
		});
		return () => cancelAnimationFrame(raf);
	}, [pinToBottom, renderRows.length, scrollElementRef]);

	useLayoutEffect(() => {
		if (!stickToBottom || renderRows.length === 0) return;
		let raf2 = 0;
		const raf1 = requestAnimationFrame(() => {
			pinToBottom();
			raf2 = requestAnimationFrame(() => pinToBottom());
		});
		return () => {
			cancelAnimationFrame(raf1);
			if (raf2) cancelAnimationFrame(raf2);
		};
	}, [lastRowChangeKey, pinToBottom, renderRows.length, stickToBottom]);

	useLayoutEffect(() => {
		const list = messageListRef.current;
		if (!list || !stickToBottom || typeof ResizeObserver === "undefined")
			return;
		const observer = new ResizeObserver(() => pinToBottom());
		observer.observe(list);
		return () => observer.disconnect();
	}, [pinToBottom, stickToBottom]);

	useLayoutEffect(() => {
		if (renderRows.length > 0) return;
		didInitialScrollRef.current = false;
	}, [renderRows.length]);

	return (
		<div ref={messageListRef} {...stylex.props(styles.messageList)}>
			{renderRows.map((item, index) => {
				if (item.type === "thinking") {
					return (
						<div
							key={getRowKey(item, index)}
							{...stylex.props(styles.messageRow)}
						>
							<ThinkingIndicator startTime={item.startTime} />
						</div>
					);
				}
				if (item.type === "edit-group") {
					return (
						<div
							key={getRowKey(item, index)}
							{...stylex.props(styles.messageRow)}
						>
							<GroupedEditDiff filePath={item.filePath} edits={item.edits} />
						</div>
					);
				}
				if (item.type === "tool-group") {
					return (
						<div
							key={getRowKey(item, index)}
							{...stylex.props(styles.messageRow)}
						>
							<ToolTimeline
								tools={item.tools}
								expandedTools={expandedTools}
								onToggle={toggleTool}
							/>
						</div>
					);
				}
				const msg = item.message;
				const checkpoint =
					msg.role === "assistant" && !msg.isStreaming
						? checkpointsByMessageId.get(msg.id)
						: undefined;
				return (
					<div
						key={getRowKey(item, index)}
						{...stylex.props(styles.messageRow)}
					>
						<Bubble
							msg={msg}
							collapsed={!expandedTools.has(msg.id)}
							onToggle={toggleTool}
							onSendMessage={handleSendMessage}
							onMdFileClick={onMdFileClick}
							slashCommandNames={slashCommandNames}
						/>
						{checkpoint && (
							<CheckpointMarker
								checkpoint={checkpoint}
								onRevert={revertCheckpoint}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
});

const styles = stylex.create({
	toolMuted: {
		color: color.textMuted,
	},
	toolAccent: {
		color: color.accent,
	},
	toolLink: {
		color: color.accent,
		textDecorationColor: {
			default: color.accentBorder,
			":hover": color.accent,
		},
		textDecorationLine: "underline",
	},
	checkpointCard: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		marginBlock: controlSize._1,
		overflow: "hidden",
	},
	goalCard: {
		alignItems: "flex-start",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		display: "flex",
		gap: controlSize._2,
		marginBlock: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2_5,
	},
	goalCardActive: {
		borderColor: color.accentBorder,
	},
	goalCardPaused: {
		borderColor: color.warningBorder,
	},
	goalCardComplete: {
		borderColor: color.successBorder,
	},
	goalIconSlot: {
		alignItems: "center",
		backgroundColor: color.surfaceControl,
		borderRadius: radius.sm,
		color: color.textMuted,
		display: "flex",
		flexShrink: 0,
		height: controlSize._6,
		justifyContent: "center",
		marginTop: 1,
		width: controlSize._6,
	},
	goalIconActive: {
		color: color.accent,
	},
	goalIconPaused: {
		color: color.warning,
	},
	goalIconComplete: {
		color: color.success,
	},
	goalCardBody: {
		minWidth: 0,
		flex: 1,
	},
	goalCardHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		minWidth: 0,
	},
	goalCardTitle: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		lineHeight: 1.35,
	},
	commandObjective: {
		color: color.accent,
		fontFamily: font.familyMono,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		lineHeight: 1.35,
		marginTop: controlSize._0_5,
		overflowWrap: "break-word",
	},
	goalTurns: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		marginLeft: "auto",
		whiteSpace: "nowrap",
	},
	goalObjective: {
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.45,
		marginTop: controlSize._0_5,
		overflowWrap: "break-word",
	},
	goalDetail: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.45,
		marginTop: controlSize._0_5,
		overflowWrap: "break-word",
	},
	checkpointHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1,
		minHeight: controlSize._5,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
	},
	checkpointToggle: {
		alignItems: "center",
		color: color.textSoft,
		display: "flex",
		flex: 1,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		minWidth: 0,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "opacity",
		transitionTimingFunction: motion.ease,
		":hover": {
			opacity: 0.8,
		},
	},
	undoButton: {
		borderRadius: radius.sm,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		paddingBlock: 0,
		paddingInline: controlSize._1,
		transitionDuration: motion.durationBase,
		transitionProperty: "color, opacity",
		transitionTimingFunction: motion.ease,
		":hover": {
			color: color.textSoft,
		},
		":disabled": {
			opacity: 0.4,
		},
	},
	revertedLabel: {
		borderRadius: radius.md,
		color: color.textMuted,
		fontSize: font.size_2,
		fontStyle: "italic",
		paddingBlock: 1,
		paddingInline: controlSize._1_5,
	},
	checkpointFiles: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._0_5,
		paddingBottom: controlSize._2,
		paddingInline: controlSize._2,
		paddingTop: controlSize._1,
	},
	checkpointFile: {
		alignItems: "center",
		display: "flex",
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		gap: controlSize._1_5,
		paddingInline: controlSize._1,
	},
	checkpointChevron: {
		flexShrink: 0,
		opacity: 0.4,
		transitionDuration: motion.durationBase,
		transitionProperty: "transform",
	},
	rotateClosed: {
		transform: "rotate(-90deg)",
	},
	checkpointIcon: {
		flexShrink: 0,
		opacity: 0.4,
		color: color.textMuted,
	},
	revertedIcon: {
		color: color.danger,
	},
	checkpointTitle: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		opacity: 0.8,
	},
	spacer: {
		flex: 1,
	},
	userRow: {
		display: "flex",
		justifyContent: "flex-end",
	},
	userBubble: {
		maxWidth: "85%",
		borderRadius: radius.lg,
		borderBottomRightRadius: radius.xs,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2_5,
	},
	userImages: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._2,
		marginBlock: controlSize._1,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._0_5,
	},
	userImageFrame: {
		position: "relative",
		display: "inline-flex",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._1,
		borderRadius: radius.sm,
		backgroundColor: "color-mix(in srgb, var(--color-inferay-bg) 78%, #f6efe4)",
		backgroundImage:
			"linear-gradient(135deg, rgba(255,255,255,0.26), rgba(255,255,255,0) 42%), repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 6px)",
		boxShadow:
			"0 0 0 1px rgba(255,255,255,0.12), 0 10px 24px rgba(30, 18, 46, 0.22), 0 0 28px rgba(176, 143, 255, 0.12)",
		transform: "rotate(-1.5deg)",
		transitionDuration: motion.durationBase,
		transitionProperty: "box-shadow, transform",
		transitionTimingFunction: motion.ease,
		":hover": {
			boxShadow:
				"0 0 0 1px rgba(255,255,255,0.16), 0 12px 28px rgba(30, 18, 46, 0.28), 0 0 34px rgba(176, 143, 255, 0.18)",
			transform: "rotate(-0.5deg) translateY(-1px)",
		},
		"::before": {
			content: '""',
			position: "absolute",
			top: "-0.38rem",
			left: "24%",
			width: "2.6rem",
			height: "0.82rem",
			borderRadius: radius.xs,
			backgroundColor: "rgba(244, 221, 181, 0.58)",
			backgroundImage:
				"linear-gradient(90deg, rgba(255,255,255,0.22), rgba(255,255,255,0))",
			boxShadow: "0 1px 4px rgba(0, 0, 0, 0.14)",
			transform: "rotate(4deg)",
			zIndex: 1,
		},
		"::after": {
			content: '""',
			position: "absolute",
			inset: controlSize._1,
			borderRadius: radius.xs,
			backgroundImage:
				"radial-gradient(circle at 22% 18%, rgba(255,255,255,0.22), transparent 25%), linear-gradient(180deg, rgba(185, 170, 255, 0.14), rgba(255, 205, 238, 0.08))",
			pointerEvents: "none",
		},
	},
	userImageFrameAlt: {
		transform: "rotate(1.25deg)",
		":hover": {
			transform: "rotate(0.4deg) translateY(-1px)",
		},
		"::before": {
			left: "auto",
			right: "18%",
			transform: "rotate(-5deg)",
		},
	},
	userImage: {
		display: "block",
		width: "clamp(5.5rem, 20vw, 8.5rem)",
		height: "clamp(4.25rem, 15vw, 6.5rem)",
		borderRadius: radius.xs,
		objectFit: "cover",
		filter: "saturate(0.88) contrast(0.96) brightness(1.05)",
	},
	userText: {
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		fontSize: font.size_3,
	},
	dot2: {
		animationDelay: "0.1s",
	},
	dot3: {
		animationDelay: "0.2s",
	},
	systemText: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
		margin: 0,
		textAlign: "center",
	},
	btwCard: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.accentBorder,
		borderRadius: radius.lg,
		backgroundColor: color.accentWash,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	btwHeader: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		marginBottom: controlSize._1_5,
	},
	btwLabel: {
		color: color.accent,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	btwQuestion: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	btwBody: {
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.6,
	},
	btwDots: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._0_5,
		paddingBlock: controlSize._1,
	},
	smallDot: {
		width: controlSize._1,
		height: controlSize._1,
		borderRadius: radius.pill,
		backgroundColor: color.accent,
		animationName: stylex.keyframes({
			"50%": {
				transform: "translateY(-2px)",
			},
		}),
		animationDuration: "0.6s",
		animationIterationCount: "infinite",
	},
	toolToggle: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_2,
		maxWidth: "100%",
		minWidth: 0,
	},
	toolName: {
		fontFamily: font.familyMono,
		fontSize: font.size_1,
	},
	toolSummary: {
		color: color.textMuted,
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolTimeline: {
		boxSizing: "border-box",
		marginInline: "auto",
		maxWidth: "34rem",
		minWidth: 0,
		width: "100%",
	},
	toolMilestone: {
		display: "grid",
		gridTemplateColumns: "0.75rem minmax(0, 1fr)",
		minWidth: 0,
		position: "relative",
	},
	toolMilestoneNode: {
		alignSelf: "stretch",
		position: "relative",
		"::before": {
			backgroundColor: color.background,
			borderColor: color.accentBorder,
			borderRadius: radius.pill,
			borderStyle: "solid",
			borderWidth: 1,
			boxShadow: "0 0 0 2px var(--color-inferay-black)",
			content: '""',
			height: controlSize._1_5,
			left: "50%",
			position: "absolute",
			top: "0.55rem",
			transform: "translateX(-50%)",
			width: controlSize._1_5,
			zIndex: 1,
		},
		"::after": {
			backgroundColor: color.borderStrong,
			bottom: "-0.74rem",
			content: '""',
			left: "50%",
			position: "absolute",
			top: "0.74rem",
			transform: "translateX(-50%)",
			width: 1,
		},
	},
	toolMilestoneNodeLast: {
		"::after": {
			display: "none",
		},
	},
	toolMilestoneBody: {
		minWidth: 0,
		paddingBottom: controlSize._1,
		paddingLeft: controlSize._1_5,
	},
	toolMilestoneToggle: {
		alignItems: "center",
		borderRadius: radius.sm,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		gap: controlSize._1_5,
		maxWidth: "100%",
		minHeight: controlSize._6,
		minWidth: 0,
		paddingInline: controlSize._1,
		textAlign: "left",
		width: "100%",
	},
	toolMilestoneLabel: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolMilestoneDetail: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		maxWidth: "42%",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolMilestoneChevron: {
		flexShrink: 0,
		marginLeft: "auto",
	},
	toolOutputWrap: {
		position: "relative",
	},
	toolOutput: {
		maxHeight: "7rem",
		overflow: "auto",
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		borderRadius: radius.sm,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.6,
		marginBottom: 0,
		marginTop: "0.125rem",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	toolCopyOverlay: {
		opacity: {
			default: 0,
			":hover": 1,
		},
		position: "absolute",
		right: controlSize._1,
		top: controlSize._1,
		transitionDuration: motion.durationBase,
		transitionProperty: "opacity",
		transitionTimingFunction: motion.ease,
	},
	assistantMessage: {
		position: "relative",
		width: "100%",
		minWidth: 0,
		overflowWrap: "break-word",
		color: color.textSoft,
		fontSize: font.size_3,
		lineHeight: 1.6,
	},
	messageActionRow: {
		display: "flex",
		justifyContent: "flex-end",
		marginTop: controlSize._1,
	},
	copyMessageButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
		display: "inline-flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		minHeight: controlSize._6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
	},
	copyMessageButtonCopied: {
		backgroundColor: color.successWash,
		color: color.success,
	},
	messageList: {
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		minHeight: "100%",
		minWidth: 0,
		paddingBottom: CHAT_LIST_BOTTOM_PADDING_PX,
		paddingInline: CHAT_LIST_INLINE_GUTTER,
		paddingTop: CHAT_LIST_TOP_PADDING_PX,
		width: "100%",
	},
	messageRow: {
		boxSizing: "border-box",
		minWidth: 0,
		position: "relative",
		width: "100%",
	},
});
