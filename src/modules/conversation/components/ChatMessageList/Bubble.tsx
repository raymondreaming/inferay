import * as stylex from "@octanejs/stylex";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	IconCheck,
	IconChevronDown,
	IconCopy,
} from "../../../../shared/ui/Icons/index.tsx";
import {
	SkillProposalCard,
	SkillReadCard,
} from "../../../skills/components/SkillProposalCard/index.tsx";
import {
	getEditToolPayload,
	getToolDisplayInfo,
} from "../../model/chat-message-render-utils.ts";
import { MiniEditDiff } from "../ChatEditDiff/index.tsx";
import {
	AskUserQuestionCard,
	CopyButton,
	Markdown,
} from "../ChatRichContent/index.tsx";
import { renderTextPills } from "../ChatTokenDecorators/index.tsx";
import { CommandSystemCard } from "./CommandSystemCard.tsx";
import { GoalSystemCard } from "./GoalSystemCard.tsx";
import type { ChatMessage } from "./shared.ts";
import { styles } from "./styles.ts";
import { ToolOutputHighlight } from "./ToolOutputHighlight.tsx";

export const Bubble = memo(function Bubble({
	paneId,
	msg,
	collapsed,
	onToggle,
	onSendMessage,
	onMdFileClick,
	slashCommandNames,
}: {
	paneId: string;
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
				? getEditToolPayload(msg.render?.toolInput)
				: null,
		[msg.content, msg.role, msg.toolName, msg.render],
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
		const skillProposal = msg.render?.skillProposal;
		if (skillProposal)
			return (
				<SkillProposalCard
					proposal={skillProposal}
					messageId={`${paneId}:${msg.id}:native`}
					onResult={onSendMessage}
				/>
			);
		const skillRead = msg.render?.skillRead;
		if (skillRead) return <SkillReadCard skill={skillRead} />;
		const goalMessage = msg.render?.goal;
		if (goalMessage) return <GoalSystemCard goal={goalMessage} />;
		const commandMessage = msg.render?.command;
		if (commandMessage) return <CommandSystemCard command={commandMessage} />;
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
					nativeQuestions={msg.render?.questions}
					content={msg.content}
					isStreaming={msg.isStreaming}
					onSendMessage={onSendMessage}
				/>
			);
		}
		if (editPayload && !msg.isStreaming) {
			return (
				<MiniEditDiff
					oldStr={editPayload.oldString}
					newStr={editPayload.newString}
					filePath={editPayload.filePath}
					isStreaming={msg.isStreaming}
				/>
			);
		}
		const display = getToolDisplayInfo(msg.toolName, msg.render?.display);
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
						size={iconSize.micro}
						{...stylex.props(
							styles.toolMilestoneChevron,
							collapsed && styles.rotateClosed,
						)}
					/>
				</button>
				{!collapsed && msg.content && (
					<div {...stylex.props(styles.toolOutputWrap)}>
						<pre {...stylex.props(styles.toolOutput)}>
							<ToolOutputHighlight render={msg.render} content={msg.content} />
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
			{(msg.render?.skillParts ?? [{ start: 0, end: msg.content.length }]).map(
				(part, index) =>
					"proposal" in part ? (
						<SkillProposalCard
							key={`${msg.id}:${part.index}`}
							messageId={`${paneId}:${msg.id}:${part.index}`}
							proposal={part.proposal}
							streaming={msg.isStreaming}
							onResult={onSendMessage}
						/>
					) : "pending" in part ? (
						<p key={index}>Preparing skill proposal…</p>
					) : (
						<Markdown
							key={index}
							text={msg.content.slice(part.start, part.end)}
							onMdFileClick={onMdFileClick}
							streaming={msg.isStreaming}
						/>
					),
			)}
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
						{copied ? (
							<IconCheck size={iconSize.compact} />
						) : (
							<IconCopy size={iconSize.compact} />
						)}
						<span>{copied ? "Copied" : "Copy"}</span>
					</button>
				</div>
			) : null}
		</div>
	);
});
