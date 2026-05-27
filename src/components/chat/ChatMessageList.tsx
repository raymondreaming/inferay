import * as stylex from "@stylexjs/stylex";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { ThinkingIndicator } from "../ui/DotMatrixLoader.tsx";
import {
	IconCheck,
	IconChevronDown,
	IconClock,
	IconCopy,
} from "../ui/Icons.tsx";
import { GroupedEditDiff, MiniEditDiff } from "./ChatEditDiff.tsx";
import { AskUserQuestionCard, Markdown } from "./ChatRichContent.tsx";
import {
	buildRenderItems,
	type RenderChatMessage,
	type RenderItem,
} from "./chat-message-render-utils.ts";
import { renderTextPills } from "./chat-token-decorators.tsx";

export type ChatMessage = RenderChatMessage;

type CheckpointInfo = {
	id: string;
	timestamp: number;
	changedFileCount: number;
	changedFiles: { path: string; action: "created" | "modified" | "deleted" }[];
	reverted: boolean;
	afterMessageId: string | null;
};

export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
	isAtEnd: () => boolean;
	getDistanceFromEnd: () => number;
};

type ChatRenderRow =
	| RenderItem
	| { type: "thinking"; key: string; startTime: number };

function estimateRowSize(row: ChatRenderRow | undefined): number {
	if (!row) return 80;
	if (row.type === "thinking") return 48;
	if (row.type === "edit-group") return 260;

	const message = row.message;
	if (message.role === "tool") {
		return message.toolName === "Edit" ? 260 : 56;
	}
	if (message.role === "assistant" || message.role === "btw") {
		return Math.min(
			460,
			Math.max(72, 52 + Math.ceil(message.content.length / 90) * 18)
		);
	}
	if (message.role === "system") return 48;
	return Math.min(
		220,
		Math.max(56, 44 + Math.ceil(message.content.length / 120) * 16)
	);
}

function getRowKey(row: ChatRenderRow | undefined, index: number) {
	if (!row) return `row-${index}`;
	if (row.type === "thinking") return row.key;
	if (row.type === "edit-group") {
		return `edit-group:${row.filePath}:${row.edits.map((edit) => edit.id).join(":")}`;
	}
	return row.message.id;
}

function ToolOutputHighlight({ content }: { content: string }) {
	try {
		if (content.trim().startsWith("{")) {
			const parsed = JSON.parse(content);
			const fileName = parsed.file_path
				? parsed.file_path.split("/").pop() || parsed.file_path
				: undefined;
			if (parsed.file_path && parsed.new_string !== undefined) {
				return (
					<>
						<span {...stylex.props(styles.toolMuted)}>{fileName}</span>
						{"\n"}
						<span {...stylex.props(styles.toolAccent)}>
							{parsed.new_string}
						</span>
					</>
				);
			}
			if (parsed.command)
				return (
					<span {...stylex.props(styles.toolAccent)}>$ {parsed.command}</span>
				);
			if (parsed.pattern)
				return (
					<span {...stylex.props(styles.toolAccent)}>/{parsed.pattern}/</span>
				);
			if (parsed.file_path && parsed.content) {
				const preview =
					parsed.content.length > 300
						? `${parsed.content.slice(0, 300)}...`
						: parsed.content;
				return (
					<>
						<span {...stylex.props(styles.toolMuted)}>{fileName}</span>
						{"\n"}
						<span {...stylex.props(styles.toolAccent)}>{preview}</span>
					</>
				);
			}
			if (parsed.file_path)
				return <span {...stylex.props(styles.toolAccent)}>{fileName}</span>;
			if (parsed.glob || parsed.include) {
				return (
					<span {...stylex.props(styles.toolAccent)}>
						{parsed.glob || parsed.include}
					</span>
				);
			}
			if (parsed.url) {
				return (
					<a
						href={parsed.url}
						target="_blank"
						rel="noopener noreferrer"
						{...stylex.props(styles.toolLink)}
					>
						{parsed.url}
					</a>
				);
			}
			if (parsed.query)
				return <span {...stylex.props(styles.toolAccent)}>{parsed.query}</span>;
		}
	} catch {}
	return <>{content}</>;
}

function CheckpointMarker({
	checkpoint,
	onRevert,
	disabled,
}: {
	checkpoint: CheckpointInfo;
	onRevert: (id: string) => void;
	disabled?: boolean;
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
							!expanded && styles.rotateClosed
						)}
					/>
					<IconClock
						size={11}
						{...stylex.props(
							styles.checkpointIcon,
							checkpoint.reverted && styles.revertedIcon
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
						disabled={disabled}
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

const Bubble = React.memo(function Bubble({
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
	const handleCopyMessage = useCallback(() => {
		if (!msg.content) return;
		navigator.clipboard
			.writeText(msg.content)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => setCopied(false));
	}, [msg.content]);

	if (msg.role === "user") {
		const commandMatch = msg.content.match(/^\/([a-zA-Z0-9_-]+)(\s|$)/);
		if (
			commandMatch?.[1] &&
			slashCommandNames.some(
				(command) => command.toLowerCase() === commandMatch[1]!.toLowerCase()
			)
		) {
			return null;
		}
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
		return (
			<div {...stylex.props(styles.userRow)}>
				<div {...stylex.props(styles.userBubble)}>
					{imagePaths.length > 0 && (
						<div {...stylex.props(styles.userImages)}>
							{imagePaths.map((imgPath) => (
								<img
									key={imgPath}
									src={`/api/file?path=${encodeURIComponent(imgPath)}`}
									alt=""
									{...stylex.props(styles.userImage)}
								/>
							))}
						</div>
					)}
					{displayContent && (
						<p {...stylex.props(styles.userText)}>
							{renderTextPills(displayContent, slashCommandNames)}
						</p>
					)}
				</div>
			</div>
		);
	}

	if (msg.role === "system") {
		const runningMatch = msg.content.match(/^Running \/(.+)\.\.\.$/);
		if (runningMatch?.[1]) {
			const commandName = runningMatch[1];
			return (
				<div {...stylex.props(styles.systemRunRow)}>
					<div {...stylex.props(styles.systemRunPill)}>
						<span {...stylex.props(styles.runningCommand)}>/{commandName}</span>
					</div>
				</div>
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
						<Markdown text={msg.content} onMdFileClick={onMdFileClick} />
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
		if (msg.toolName === "Edit" && msg.content) {
			try {
				const parsed = JSON.parse(msg.content);
				if (
					parsed.file_path &&
					parsed.old_string !== undefined &&
					parsed.new_string !== undefined
				) {
					return (
						<MiniEditDiff
							oldStr={parsed.old_string}
							newStr={parsed.new_string}
							filePath={parsed.file_path}
							isStreaming={msg.isStreaming}
						/>
					);
				}
			} catch {}
		}
		return (
			<div>
				<button
					type="button"
					onClick={() => onToggle(msg.id)}
					{...stylex.props(styles.toolToggle)}
				>
					<IconChevronDown
						size={7}
						{...stylex.props(collapsed && styles.rotateClosed)}
					/>
					<span {...stylex.props(styles.toolName)}>{msg.toolName}</span>
				</button>
				{!collapsed && msg.content && (
					<pre {...stylex.props(styles.toolOutput)}>
						<ToolOutputHighlight content={msg.content} />
					</pre>
				)}
			</div>
		);
	}

	return (
		<div {...stylex.props(styles.assistantMessage)}>
			<Markdown text={msg.content} onMdFileClick={onMdFileClick} />
			{!msg.isStreaming && msg.content.trim() ? (
				<div {...stylex.props(styles.messageActionRow)}>
					<button
						type="button"
						onClick={handleCopyMessage}
						title={copied ? "Copied" : "Copy message"}
						aria-label={copied ? "Copied message" : "Copy message"}
						{...stylex.props(
							styles.copyMessageButton,
							copied && styles.copyMessageButtonCopied
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

export function ChatMessageList({
	messages,
	scrollElementRef,
	onVirtualizerReady,
	expandedTools,
	toggleTool,
	checkpoints,
	revertCheckpoint,
	isLoading,
	startTime,
	handleSendMessage,
	onMdFileClick,
	slashCommandNames,
}: {
	messages: ChatMessage[];
	scrollElementRef: React.RefObject<HTMLDivElement | null>;
	onVirtualizerReady?: (controls: ChatVirtualizerControls | null) => void;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	checkpoints: CheckpointInfo[];
	revertCheckpoint: (id: string) => void;
	isLoading: boolean;
	startTime?: number | null;
	handleSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
}) {
	const renderItems = useMemo(() => buildRenderItems(messages), [messages]);
	const renderRows = useMemo<ChatRenderRow[]>(() => {
		if (!isLoading || !startTime) return renderItems;
		return [
			...renderItems,
			{ type: "thinking", key: `thinking-${startTime}`, startTime },
		];
	}, [isLoading, renderItems, startTime]);
	const virtualizer = useVirtualizer({
		count: renderRows.length,
		getScrollElement: () => scrollElementRef.current,
		estimateSize: (index) => estimateRowSize(renderRows[index]),
		getItemKey: (index) => getRowKey(renderRows[index], index),
		anchorTo: "end",
		followOnAppend: true,
		scrollEndThreshold: 80,
		overscan: 6,
		gap: 8,
		paddingStart: 8,
		paddingEnd: 32,
		useFlushSync: false,
	});
	const didInitialScrollRef = useRef(false);

	useEffect(() => {
		onVirtualizerReady?.({
			scrollToEnd: (behavior = "smooth") => {
				virtualizer.scrollToEnd({ behavior });
			},
			isAtEnd: () => virtualizer.isAtEnd(80),
			getDistanceFromEnd: () => virtualizer.getDistanceFromEnd(),
		});
		return () => onVirtualizerReady?.(null);
	}, [onVirtualizerReady, virtualizer]);

	useLayoutEffect(() => {
		if (didInitialScrollRef.current || renderRows.length === 0) return;
		didInitialScrollRef.current = true;
		const raf = requestAnimationFrame(() => {
			virtualizer.scrollToEnd({ behavior: "auto" });
		});
		return () => cancelAnimationFrame(raf);
	}, [renderRows.length, virtualizer]);

	const virtualItems = virtualizer.getVirtualItems();
	return (
		<div
			{...stylex.props(styles.messageList)}
			style={{ height: virtualizer.getTotalSize() }}
		>
			{virtualItems.map((virtualItem) => {
				const item = renderRows[virtualItem.index];
				if (!item) return null;
				if (item.type === "thinking") {
					return (
						<div
							key={virtualItem.key}
							ref={virtualizer.measureElement}
							data-index={virtualItem.index}
							{...stylex.props(styles.virtualRow)}
							style={{ transform: `translateY(${virtualItem.start}px)` }}
						>
							<ThinkingIndicator startTime={item.startTime} />
						</div>
					);
				}
				if (item.type === "edit-group") {
					return (
						<div
							key={virtualItem.key}
							ref={virtualizer.measureElement}
							data-index={virtualItem.index}
							{...stylex.props(styles.virtualRow)}
							style={{ transform: `translateY(${virtualItem.start}px)` }}
						>
							<GroupedEditDiff filePath={item.filePath} edits={item.edits} />
						</div>
					);
				}
				const msg = item.message;
				return (
					<div
						key={virtualItem.key}
						ref={virtualizer.measureElement}
						data-index={virtualItem.index}
						{...stylex.props(styles.virtualRow)}
						style={{ transform: `translateY(${virtualItem.start}px)` }}
					>
						<Bubble
							msg={msg}
							collapsed={!expandedTools.has(msg.id)}
							onToggle={toggleTool}
							onSendMessage={handleSendMessage}
							onMdFileClick={onMdFileClick}
							slashCommandNames={slashCommandNames}
						/>
						{msg.role === "assistant" &&
							!msg.isStreaming &&
							(() => {
								const cp = checkpoints.find((c) => c.afterMessageId === msg.id);
								if (!cp) return null;
								return (
									<CheckpointMarker
										checkpoint={cp}
										onRevert={revertCheckpoint}
										disabled={isLoading}
									/>
								);
							})()}
					</div>
				);
			})}
		</div>
	);
}

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
		gap: controlSize._1_5,
		marginBottom: controlSize._1_5,
	},
	userImage: {
		maxWidth: "8rem",
		maxHeight: "6rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.borderControl,
		borderRadius: radius.sm,
		objectFit: "cover",
	},
	userText: {
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		fontSize: font.size_3,
	},
	systemRunRow: {
		display: "flex",
		justifyContent: "center",
		paddingBlock: controlSize._1,
	},
	systemRunPill: {
		display: "inline-flex",
		alignItems: "center",
		gap: controlSize._2_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		borderRadius: radius.lg,
		backgroundColor: color.accentWash,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	runningCommand: {
		color: color.accent,
		fontFamily: font.familyMono,
		fontSize: font.size_4,
		fontWeight: font.weight_5,
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
	},
	toolName: {
		fontFamily: font.familyMono,
		fontSize: font.size_1,
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
		marginTop: "0.125rem",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
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
		minHeight: "100%",
		minWidth: 0,
		position: "relative",
		width: "100%",
	},
	virtualRow: {
		boxSizing: "border-box",
		left: 0,
		paddingInline: controlSize._3,
		position: "absolute",
		top: 0,
		width: "100%",
	},
});
