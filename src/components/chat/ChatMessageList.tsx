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
import { isChatAgentKind } from "../../features/agents/agents.ts";
import {
	createDocumentArtifact,
	loadDocumentArtifacts,
} from "../../features/artifacts/artifact-workspace-store.ts";
import { describeComposerContextBlock } from "../../features/chat/composer-context.ts";
import {
	loadStoredMessages,
	loadStoredSummary,
} from "../../features/chat/chat-session-store.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";
import {
	getPaneTitle,
	loadTerminalState,
	type TerminalPaneModel,
} from "../../features/terminal/terminal-utils.ts";
import {
	color,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { ThinkingIndicator } from "../ui/DotMatrixLoader.tsx";
import { DropdownButton } from "../ui/DropdownButton.tsx";
import {
	IconAlertTriangle,
	IconCheck,
	IconChevronDown,
	IconCopy,
	IconFilePlus,
	IconSend,
} from "../ui/Icons.tsx";
import { GroupedEditDiff, MiniEditDiff } from "./ChatEditDiff.tsx";
import { AskUserQuestionCard, Markdown } from "./ChatRichContent.tsx";
import {
	buildRenderItems,
	formatSystemMessageNotice,
	type RenderChatMessage,
	type RenderItem,
} from "./chat-message-render-utils.ts";
import { renderTextPills } from "./chat-token-decorators.tsx";

export type ChatMessage = RenderChatMessage;

export type ChatVirtualizerControls = {
	scrollToEnd: (behavior?: ScrollBehavior) => void;
	isAtEnd: () => boolean;
	getDistanceFromEnd: () => number;
};

const APP_REGION_DRAG_CLASS = "electrobun-webkit-app-region-drag";
const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";
const CHAT_SCROLL_DISTANCE_KEY_PREFIX = "inferay-scroll-distance:";

function dragClassName(className?: string) {
	return className
		? `${APP_REGION_DRAG_CLASS} ${className}`
		: APP_REGION_DRAG_CLASS;
}

function noDragClassName(className?: string) {
	return className
		? `${APP_REGION_NO_DRAG_CLASS} ${className}`
		: APP_REGION_NO_DRAG_CLASS;
}

type ChatRenderRow =
	| RenderItem
	| { type: "thinking"; key: string; startTime: number };

type HandoverTarget = {
	id: string;
	label: string;
	detail?: string;
};

function compactTitle(text: string) {
	const normalized = text.trim().split("\n")[0]?.trim() ?? "";
	return normalized.length > 60
		? `${normalized.slice(0, 57).trim()}...`
		: normalized;
}

function getPaneBaseFolder(pane: TerminalPaneModel): string | undefined {
	return pane.cwd?.split("/").filter(Boolean).pop();
}

function getSidebarLikePaneTitle(pane: TerminalPaneModel): string {
	const storedSummary = loadStoredSummary(pane.id) ?? pane.summary ?? null;
	if (storedSummary?.trim()) return storedSummary.trim();

	const firstUser = loadStoredMessages<{ role?: string; content?: string }>(
		pane.id
	).find((message) => message.role === "user" && message.content?.trim());
	if (firstUser?.content) {
		const title = compactTitle(firstUser.content);
		if (title) return title;
	}

	return pane.title || getPaneTitle(pane);
}

function loadHandoverTargets(currentPaneId: string): HandoverTarget[] {
	const targets: HandoverTarget[] = [];
	for (const group of loadTerminalState()?.groups ?? []) {
		for (const pane of group.panes) {
			if (pane.id === currentPaneId || !isChatAgentKind(pane.agentKind)) {
				continue;
			}
			targets.push({
				id: pane.id,
				label: getSidebarLikePaneTitle(pane),
				detail: getPaneBaseFolder(pane),
			});
		}
	}
	return targets;
}

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

function loadScrollDistance(paneId: string): number | null {
	try {
		const stored = readStoredValue(
			`${CHAT_SCROLL_DISTANCE_KEY_PREFIX}${paneId}`
		);
		if (stored === null) return null;
		const value = Number(stored);
		return Number.isFinite(value) && value >= 0 ? value : null;
	} catch {
		return null;
	}
}

function saveScrollDistance(paneId: string, distance: number): void {
	try {
		writeStoredValue(
			`${CHAT_SCROLL_DISTANCE_KEY_PREFIX}${paneId}`,
			String(Math.max(0, Math.round(distance)))
		);
	} catch {}
}

function dispatchPaneFocus(paneId: string | null) {
	window.dispatchEvent(
		new CustomEvent("inferay:pane-focus-highlight", {
			detail: { paneId },
		})
	);
}

function buildHandoverPrompt({
	sourcePaneId,
	sourceRole,
	content,
}: {
	sourcePaneId: string;
	sourceRole: string;
	content: string;
}) {
	return [
		"You are receiving a handoff from another Inferay agent pane.",
		"",
		"Read the transferred context, identify the current state, and continue from it without asking the user to repeat themselves.",
		"",
		`Source pane: ${sourcePaneId}`,
		`Source role: ${sourceRole}`,
		"",
		"Transferred context:",
		content.trim(),
	].join("\n");
}

function findSavedArtifactForMessage(paneId: string, messageId: string) {
	return (
		loadDocumentArtifacts().find(
			(artifact) =>
				artifact.sourcePaneId === paneId &&
				artifact.sourceMessageId === messageId
		) ?? null
	);
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

const Bubble = React.memo(function Bubble({
	msg,
	collapsed,
	onToggle,
	onSendMessage,
	onMdFileClick,
	slashCommandNames,
	paneId,
	cwd,
	handoverTargets,
}: {
	msg: ChatMessage;
	collapsed: boolean;
	onToggle: (id: string) => void;
	onSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
	paneId: string;
	cwd?: string | null;
	handoverTargets: HandoverTarget[];
}) {
	const [copied, setCopied] = useState(false);
	const [savedArtifactId, setSavedArtifactId] = useState(
		() => findSavedArtifactForMessage(paneId, msg.id)?.id ?? null
	);
	const [artifactSaveFailed, setArtifactSaveFailed] = useState(false);
	const savedArtifact = savedArtifactId !== null;
	const messageActionIconProps = stylex.props(styles.messageActionIcon);
	const handoverOptions = handoverTargets.map((target) => ({
		id: target.id,
		label: target.label,
		detail: target.detail,
		icon: <IconSend size={12} strokeWidth={1.45} {...messageActionIconProps} />,
	}));
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
	useEffect(() => {
		setSavedArtifactId(findSavedArtifactForMessage(paneId, msg.id)?.id ?? null);
		setArtifactSaveFailed(false);
	}, [msg.id, paneId]);
	const handleHandoverMessage = useCallback(
		(targetPaneId?: string) => {
			if (!targetPaneId || !msg.content.trim()) return;
			const prompt = buildHandoverPrompt({
				sourcePaneId: paneId,
				sourceRole: msg.role,
				content: msg.content,
			});
			window.dispatchEvent(
				new CustomEvent("inferay:agent-handover-request", {
					detail: {
						targetPaneId,
						sourcePaneId: paneId,
						sourceMessageId: msg.id,
						prompt,
						displayText: "Hand off",
					},
				})
			);
			dispatchPaneFocus(null);
		},
		[msg.content, msg.id, msg.role, paneId]
	);
	const handleSaveArtifact = useCallback(async () => {
		if (!msg.content.trim()) return;
		const existing = findSavedArtifactForMessage(paneId, msg.id);
		if (existing) {
			setSavedArtifactId(existing.id);
			setArtifactSaveFailed(false);
			return;
		}
		const firstLine =
			msg.content
				.split(/\r?\n/)
				.map((line) => line.trim().replace(/^#+\s*/, ""))
				.find(Boolean) ?? "Saved agent note";
		const title =
			firstLine.length > 64 ? `${firstLine.slice(0, 61).trim()}...` : firstLine;
		try {
			const artifact = await createDocumentArtifact({
				title,
				subtitle: `${msg.role} message`,
				content: msg.content,
				sourcePaneId: paneId,
				sourceMessageId: msg.id,
				sourceRole: msg.role,
				projectPath: cwd ?? null,
			});
			setSavedArtifactId(artifact.id);
			setArtifactSaveFailed(false);
		} catch (error) {
			console.error(error);
			setSavedArtifactId(null);
			setArtifactSaveFailed(true);
		}
	}, [cwd, msg.content, msg.id, msg.role, paneId]);
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
		const userBubbleProps = stylex.props(styles.userBubble);
		return (
			<div {...stylex.props(styles.userRow)}>
				<div
					{...userBubbleProps}
					className={noDragClassName(userBubbleProps.className)}
				>
					{(msg.contextBlocks?.length ?? 0) > 0 && (
						<div {...stylex.props(styles.userMetaRow)}>
							{msg.contextBlocks?.slice(0, 3).map((block) => (
								<span key={block.id} {...stylex.props(styles.contextPill)}>
									{describeComposerContextBlock(block)}
								</span>
							))}
							{(msg.contextBlocks?.length ?? 0) > 3 && (
								<span {...stylex.props(styles.contextPill)}>
									+{(msg.contextBlocks?.length ?? 0) - 3}
								</span>
							)}
						</div>
					)}
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
			const systemRunPillProps = stylex.props(styles.systemRunPill);
			return (
				<div {...stylex.props(styles.systemRunRow)}>
					<div
						{...systemRunPillProps}
						className={noDragClassName(systemRunPillProps.className)}
					>
						<span {...stylex.props(styles.runningCommand)}>/{commandName}</span>
					</div>
				</div>
			);
		}
		const notice = formatSystemMessageNotice(msg.content);
		if (notice) {
			const systemNoticeProps = stylex.props(styles.systemNotice);
			return (
				<div
					{...systemNoticeProps}
					className={noDragClassName(systemNoticeProps.className)}
				>
					<div {...stylex.props(styles.systemNoticeHeader)}>
						<IconAlertTriangle
							size={12}
							{...stylex.props(styles.systemNoticeIcon)}
						/>
						<span {...stylex.props(styles.systemNoticeTitle)}>
							{notice.title}
						</span>
					</div>
					<p {...stylex.props(styles.systemNoticeDetail)}>{notice.detail}</p>
					<details {...stylex.props(styles.systemNoticeDetails)}>
						<summary {...stylex.props(styles.systemNoticeSummary)}>
							Details
						</summary>
						<code {...stylex.props(styles.systemNoticeRaw)}>{notice.raw}</code>
					</details>
				</div>
			);
		}
		const systemTextProps = stylex.props(styles.systemText);
		return (
			<p
				{...systemTextProps}
				className={noDragClassName(systemTextProps.className)}
			>
				{msg.content}
			</p>
		);
	}

	if (msg.role === "btw") {
		const btwCardProps = stylex.props(styles.btwCard);
		return (
			<div
				{...btwCardProps}
				className={noDragClassName(btwCardProps.className)}
			>
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
				<div className={APP_REGION_NO_DRAG_CLASS}>
					<AskUserQuestionCard
						content={msg.content}
						isStreaming={msg.isStreaming}
						onSendMessage={onSendMessage}
					/>
				</div>
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
						<div className={APP_REGION_NO_DRAG_CLASS}>
							<MiniEditDiff
								oldStr={parsed.old_string}
								newStr={parsed.new_string}
								filePath={parsed.file_path}
								isStreaming={msg.isStreaming}
							/>
						</div>
					);
				}
			} catch {}
		}
		return (
			<div className={APP_REGION_NO_DRAG_CLASS}>
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

	const assistantMessageProps = stylex.props(styles.assistantMessage);
	const artifactButtonProps = stylex.props(
		styles.copyMessageButton,
		savedArtifact && styles.artifactSavedButton
	);
	const copyButtonProps = stylex.props(
		styles.copyMessageButton,
		copied && styles.copyMessageButtonCopied
	);
	const messageActionDropdownProps = stylex.props(styles.messageActionDropdown);
	return (
		<div
			{...assistantMessageProps}
			className={dragClassName(assistantMessageProps.className)}
		>
			<div
				className={APP_REGION_NO_DRAG_CLASS}
				style={{ display: "inline-block", maxWidth: "100%" }}
			>
				<Markdown text={msg.content} onMdFileClick={onMdFileClick} />
			</div>
			{!msg.isStreaming && msg.content.trim() ? (
				<div {...stylex.props(styles.messageActionRow)}>
					<button
						type="button"
						onClick={handleSaveArtifact}
						title={
							artifactSaveFailed
								? "Could not save artifact"
								: savedArtifact
									? "Saved as artifact"
									: "Save message as artifact"
						}
						aria-label={
							artifactSaveFailed
								? "Could not save artifact"
								: savedArtifact
									? "Saved as artifact"
									: "Save message as artifact"
						}
						{...artifactButtonProps}
						className={noDragClassName(artifactButtonProps.className)}
					>
						{artifactSaveFailed ? (
							<IconAlertTriangle
								size={12}
								strokeWidth={1.6}
								{...messageActionIconProps}
							/>
						) : savedArtifact ? (
							<IconCheck
								size={12}
								strokeWidth={1.6}
								{...messageActionIconProps}
							/>
						) : (
							<IconFilePlus
								size={12}
								strokeWidth={1.6}
								{...messageActionIconProps}
							/>
						)}
						<span>
							{artifactSaveFailed
								? "Failed"
								: savedArtifact
									? "Saved"
									: "Artifact"}
						</span>
					</button>
					{handoverTargets.length > 0 && (
						<div {...stylex.props(styles.handoverWrap)}>
							<DropdownButton
								value={null}
								options={handoverOptions}
								onChange={handleHandoverMessage}
								placeholder="Handoff"
								icon={
									<IconSend
										size={12}
										strokeWidth={1.45}
										{...messageActionIconProps}
									/>
								}
								minWidth={210}
								menuPlacement="top"
								buttonClassName={noDragClassName(
									messageActionDropdownProps.className
								)}
								labelClassName={
									stylex.props(styles.messageActionLabel).className
								}
								renderOption={(option, isSelected) => (
									<div
										{...stylex.props(
											styles.handoffOption,
											isSelected && styles.handoffOptionSelected
										)}
										onFocus={() => dispatchPaneFocus(option.id)}
										onMouseEnter={() => dispatchPaneFocus(option.id)}
										onMouseLeave={() => dispatchPaneFocus(null)}
									>
										<span {...stylex.props(styles.handoffOptionIcon)}>
											{option.icon}
										</span>
										<span {...stylex.props(styles.handoffOptionText)}>
											<span {...stylex.props(styles.handoffOptionLabel)}>
												{option.label}
											</span>
											{option.detail ? (
												<span {...stylex.props(styles.handoffOptionDetail)}>
													{option.detail}
												</span>
											) : null}
										</span>
									</div>
								)}
							/>
						</div>
					)}
					<button
						type="button"
						onClick={handleCopyMessage}
						title={copied ? "Copied" : "Copy message"}
						aria-label={copied ? "Copied message" : "Copy message"}
						{...copyButtonProps}
						className={noDragClassName(copyButtonProps.className)}
					>
						{copied ? (
							<IconCheck
								size={12}
								strokeWidth={1.6}
								{...messageActionIconProps}
							/>
						) : (
							<IconCopy
								size={12}
								strokeWidth={1.6}
								{...messageActionIconProps}
							/>
						)}
						<span>{copied ? "Copied" : "Copy"}</span>
					</button>
				</div>
			) : null}
		</div>
	);
});

export const ChatMessageList = React.memo(function ChatMessageList({
	messages,
	scrollElementRef,
	onVirtualizerReady,
	expandedTools,
	toggleTool,
	isLoading,
	startTime,
	handleSendMessage,
	onMdFileClick,
	slashCommandNames,
	paneId,
	cwd,
}: {
	messages: ChatMessage[];
	scrollElementRef: React.RefObject<HTMLDivElement | null>;
	onVirtualizerReady?: (controls: ChatVirtualizerControls | null) => void;
	expandedTools: Set<string>;
	toggleTool: (id: string) => void;
	isLoading: boolean;
	startTime?: number | null;
	handleSendMessage?: (text: string) => void;
	onMdFileClick?: (path: string) => void;
	slashCommandNames: readonly string[];
	paneId: string;
	cwd?: string | null;
}) {
	const [terminalStateVersion, setTerminalStateVersion] = useState(0);
	const renderItems = useMemo(() => buildRenderItems(messages), [messages]);
	const handoverTargets = useMemo(
		() => loadHandoverTargets(paneId),
		[paneId, terminalStateVersion]
	);
	const renderRows = useMemo<ChatRenderRow[]>(() => {
		const rows: ChatRenderRow[] = renderItems;
		if (!isLoading || !startTime) return rows;
		return [
			...rows,
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
		paddingStart: 20,
		paddingEnd: 32,
		useFlushSync: false,
	});
	const didInitialRestoreRef = useRef(false);
	const saveScrollFrameRef = useRef<number | null>(null);

	useEffect(() => {
		const refreshTargets = () =>
			setTerminalStateVersion((version) => version + 1);
		window.addEventListener("terminal-shell-change", refreshTargets);
		return () =>
			window.removeEventListener("terminal-shell-change", refreshTargets);
	}, []);

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
		if (didInitialRestoreRef.current || renderRows.length === 0) return;
		didInitialRestoreRef.current = true;
		const savedDistance = loadScrollDistance(paneId);
		let raf = 0;
		let frame = 0;
		const restore = () => {
			const el = scrollElementRef.current;
			if (el) {
				if (savedDistance === null || savedDistance <= 80) {
					virtualizer.scrollToEnd({ behavior: "auto" });
				} else {
					const offset = Math.max(
						0,
						virtualizer.getTotalSize() - el.clientHeight - savedDistance
					);
					virtualizer.scrollToOffset(offset, { behavior: "auto" });
				}
			}
			frame += 1;
			if (frame < 5) raf = requestAnimationFrame(restore);
		};
		raf = requestAnimationFrame(restore);
		return () => cancelAnimationFrame(raf);
	}, [paneId, renderRows.length, scrollElementRef, virtualizer]);

	useEffect(() => {
		const el = scrollElementRef.current;
		if (!el) return;
		const persist = () => {
			saveScrollFrameRef.current = null;
			saveScrollDistance(paneId, virtualizer.getDistanceFromEnd());
		};
		const handleScroll = () => {
			if (saveScrollFrameRef.current !== null) {
				cancelAnimationFrame(saveScrollFrameRef.current);
			}
			saveScrollFrameRef.current = requestAnimationFrame(persist);
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => {
			el.removeEventListener("scroll", handleScroll);
			if (saveScrollFrameRef.current !== null) {
				cancelAnimationFrame(saveScrollFrameRef.current);
				persist();
			}
		};
	}, [paneId, scrollElementRef, virtualizer]);

	const virtualItems = virtualizer.getVirtualItems();
	const messageListProps = stylex.props(styles.messageList);
	const virtualRowProps = stylex.props(styles.virtualRow);
	return (
		<div
			{...messageListProps}
			className={dragClassName(messageListProps.className)}
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
							{...virtualRowProps}
							className={dragClassName(virtualRowProps.className)}
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
							{...virtualRowProps}
							className={dragClassName(virtualRowProps.className)}
							style={{ transform: `translateY(${virtualItem.start}px)` }}
						>
							<div className={APP_REGION_NO_DRAG_CLASS}>
								<GroupedEditDiff filePath={item.filePath} edits={item.edits} />
							</div>
						</div>
					);
				}
				const msg = item.message;
				return (
					<div
						key={virtualItem.key}
						ref={virtualizer.measureElement}
						data-index={virtualItem.index}
						{...virtualRowProps}
						className={dragClassName(virtualRowProps.className)}
						style={{ transform: `translateY(${virtualItem.start}px)` }}
					>
						<Bubble
							msg={msg}
							collapsed={!expandedTools.has(msg.id)}
							onToggle={toggleTool}
							onSendMessage={handleSendMessage}
							onMdFileClick={onMdFileClick}
							slashCommandNames={slashCommandNames}
							paneId={paneId}
							cwd={cwd}
							handoverTargets={handoverTargets}
						/>
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
	rotateClosed: {
		transform: "rotate(-90deg)",
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
	userMetaRow: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._1,
		justifyContent: "flex-end",
		marginBottom: controlSize._1,
		maxWidth: "100%",
	},
	contextPill: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.borderSubtle,
		borderRadius: radius.pill,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		display: "inline-block",
		fontFamily: "var(--font-diff)",
		fontSize: font.size_0_5,
		maxWidth: "14rem",
		overflow: "hidden",
		paddingBlock: 1,
		paddingInline: controlSize._1,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
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
	systemNotice: {
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		backgroundColor: color.backgroundRaised,
		color: color.textMuted,
		marginInline: "auto",
		maxWidth: "34rem",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
	systemNoticeHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1_5,
	},
	systemNoticeIcon: {
		color: color.textMuted,
		opacity: 0.7,
	},
	systemNoticeTitle: {
		color: color.textSoft,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
	},
	systemNoticeDetail: {
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.45,
		marginTop: controlSize._1,
	},
	systemNoticeDetails: {
		marginTop: controlSize._1_5,
	},
	systemNoticeSummary: {
		color: color.textMuted,
		cursor: "pointer",
		fontSize: font.size_0_5,
		userSelect: "none",
	},
	systemNoticeRaw: {
		color: color.textMuted,
		display: "block",
		fontFamily: font.familyMono,
		fontSize: font.size_0_5,
		lineHeight: 1.45,
		marginTop: controlSize._1,
		maxHeight: "7rem",
		overflow: "auto",
		whiteSpace: "pre-wrap",
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
	handoverWrap: {
		position: "relative",
	},
	messageActionDropdown: {
		"--dropdown-button-bg-color": color.transparent,
		"--dropdown-button-bg-image": "none",
		"--dropdown-button-border-color": color.transparent,
		"--dropdown-button-border-width": "0",
		"--dropdown-button-color": color.textMuted,
		"--dropdown-button-hover-bg-color": color.transparent,
		"--dropdown-button-hover-bg-image": "none",
		"--dropdown-button-hover-shadow": "none",
		"--dropdown-button-open-bg-color": color.transparent,
		"--dropdown-button-open-bg-image": "none",
		"--dropdown-button-open-border-color": color.transparent,
		"--dropdown-button-open-color": color.textMuted,
		"--dropdown-button-open-shadow": "none",
		"--dropdown-button-shadow": "none",
		backgroundImage: "none",
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		borderRadius: radius.sm,
		borderWidth: 0,
		boxShadow: "none",
		color: color.textMuted,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		height: controlSize._6,
		minHeight: controlSize._6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
	},
	messageActionLabel: {
		color: "currentColor",
		fontSize: font.size_2,
	},
	messageActionIcon: {
		color: "currentColor",
		display: "block",
		flexShrink: 0,
		height: controlSize._3,
		opacity: 1,
		width: controlSize._3,
	},
	handoffOption: {
		alignItems: "center",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		borderRadius: radius.sm,
		boxShadow: {
			default: "none",
			":hover": shadow.controlDepth,
		},
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		gap: controlSize._2,
		minHeight: 30,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, background-image, box-shadow, color",
		transitionTimingFunction: motion.ease,
		width: "100%",
	},
	handoffOptionSelected: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		boxShadow: shadow.selectedRing,
		color: color.textMain,
	},
	handoffOptionIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	handoffOptionText: {
		display: "flex",
		flexDirection: "column",
		gap: 1,
		minWidth: 0,
	},
	handoffOptionLabel: {
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	handoffOptionDetail: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	copyMessageButton: {
		alignItems: "center",
		backgroundColor: color.transparent,
		borderRadius: radius.sm,
		color: color.textMuted,
		display: "inline-flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1,
		minHeight: controlSize._6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._1_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "color",
		transitionTimingFunction: motion.ease,
	},
	artifactSavedButton: {
		animationDuration: "900ms",
		animationIterationCount: 1,
		animationName: stylex.keyframes({
			"0%": {
				backgroundPosition: "0% 50%",
				boxShadow:
					"inset 0 0 0 1px color-mix(in srgb, var(--color-inferay-accent) 16%, transparent)",
			},
			"45%": {
				backgroundPosition: "100% 50%",
				boxShadow:
					"inset 0 0 0 1px color-mix(in srgb, var(--color-inferay-info) 34%, transparent)",
			},
			"100%": {
				backgroundPosition: "0% 50%",
				boxShadow:
					"inset 0 0 0 1px color-mix(in srgb, var(--color-inferay-accent) 20%, transparent)",
			},
		}),
		animationTimingFunction: motion.ease,
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-accent) 8%, transparent)",
		backgroundImage:
			"radial-gradient(circle at 0 0, color-mix(in srgb, var(--color-inferay-accent) 24%, transparent), transparent 55%), radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--color-inferay-info) 14%, transparent), transparent 50%)",
		backgroundSize: "180% 180%",
		boxShadow:
			"inset 0 0 0 1px color-mix(in srgb, var(--color-inferay-accent) 20%, transparent)",
		color: color.textMuted,
	},
	copyMessageButtonCopied: {
		backgroundColor: color.successWash,
		color: color.textMuted,
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
