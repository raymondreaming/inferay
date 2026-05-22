import * as stylex from "@stylexjs/stylex";
import React, { useEffect, useMemo, useState } from "react";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import {
	IconEye,
	IconFilePlus,
	IconGlobe,
	IconPencil,
	IconSearch,
	IconStop,
	IconTerminal,
	IconWrench,
} from "../ui/Icons.tsx";
import type { ChatMessage } from "../../features/chat/agent-chat-shared.ts";
import {
	extractToolActivities,
	getStatusToolName,
	normalizeToolName,
	type ToolActivity,
} from "./chat-agent-utils.ts";

interface AgentChatStatusBarProps {
	messages: ChatMessage[];
	liveActivities?: ToolActivity[];
	isLoading: boolean;
	status: string;
	onStop: () => void;
}

function ToolStatusIcon({ toolName }: { toolName: string }) {
	switch (normalizeToolName(toolName)) {
		case "read":
			return <IconEye size={12} {...stylex.props(styles.toolIcon)} />;
		case "edit":
		case "patch":
			return <IconPencil size={12} {...stylex.props(styles.toolIcon)} />;
		case "write":
			return <IconFilePlus size={12} {...stylex.props(styles.toolIcon)} />;
		case "bash":
		case "exec":
			return <IconTerminal size={12} {...stylex.props(styles.toolIcon)} />;
		case "grep":
		case "glob":
			return <IconSearch size={12} {...stylex.props(styles.toolIcon)} />;
		case "web_search":
		case "websearch":
		case "webfetch":
			return <IconGlobe size={12} {...stylex.props(styles.toolIcon)} />;
		default:
			return <IconWrench size={12} {...stylex.props(styles.toolIcon)} />;
	}
}

export const AgentChatStatusBar = React.memo(function AgentChatStatusBar({
	messages,
	liveActivities = [],
	isLoading,
	status,
	onStop,
}: AgentChatStatusBarProps) {
	const [isHovered, setIsHovered] = useState(false);
	const [statusActivities, setStatusActivities] = useState<
		Array<{
			id: string;
			toolName: string;
			isStreaming: boolean;
			summary: string;
		}>
	>([]);
	const toolActivities = useMemo(
		() => extractToolActivities(messages),
		[messages]
	);
	const statusToolName = getStatusToolName(status);

	useEffect(() => {
		if (!isLoading) {
			setStatusActivities([]);
			return;
		}
		if (!statusToolName) return;
		setStatusActivities((prev) => {
			if (prev[prev.length - 1]?.toolName === statusToolName) return prev;
			return [
				...prev,
				{
					id: `status-${statusToolName}-${prev.length}`,
					toolName: statusToolName,
					isStreaming: true,
					summary: statusToolName,
				},
			].slice(-12);
		});
	}, [isLoading, statusToolName]);

	if (!isLoading) return null;
	const activityItems =
		liveActivities.length > 0
			? liveActivities
			: toolActivities.length > 0
				? toolActivities
				: statusActivities;
	const latestActivity = activityItems[activityItems.length - 1];
	const hasActivity = activityItems.length > 0 || statusToolName || isLoading;
	const displayToolName = latestActivity?.toolName ?? statusToolName;
	const displaySummary =
		latestActivity?.summary ??
		statusToolName ??
		(status === "responding" ? "Responding" : "Working...");
	const activityCount = activityItems.length;

	return (
		<div {...stylex.props(styles.root)}>
			{hasActivity ? (
				<div
					{...stylex.props(styles.activityWrap)}
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
				>
					<div {...stylex.props(styles.activityPill)}>
						{displayToolName && (
							<span {...stylex.props(styles.activityIcon)}>
								<ToolStatusIcon toolName={displayToolName} />
							</span>
						)}
						<span {...stylex.props(styles.activitySummary)}>
							{displaySummary || "Working..."}
						</span>
						{activityCount > 1 && (
							<span {...stylex.props(styles.activityCount)}>
								+{activityCount - 1}
							</span>
						)}
					</div>

					{isHovered && activityCount > 0 && (
						<div {...stylex.props(styles.activityPopover)}>
							<div {...stylex.props(styles.popoverHeader)}>
								<span>Activity</span>
								<span {...stylex.props(styles.tabularText)}>
									{activityCount}
								</span>
							</div>
							<div {...stylex.props(styles.popoverList)}>
								{activityItems.map((activity, idx) => (
									<div
										key={activity.id}
										{...stylex.props(
											styles.popoverRow,
											idx < activityItems.length - 1
												? styles.popoverRowBorder
												: null
										)}
									>
										<span {...stylex.props(styles.activityIcon)}>
											<ToolStatusIcon toolName={activity.toolName} />
										</span>
										<span {...stylex.props(styles.popoverSummary)}>
											{activity.summary}
										</span>
										{activity.isStreaming && (
											<span {...stylex.props(styles.liveDot)} />
										)}
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			) : (
				<div {...stylex.props(styles.idleStatus)}>
					<span {...stylex.props(styles.liveDot)} />
					<span {...stylex.props(styles.idleText)}>Working...</span>
				</div>
			)}

			<button
				type="button"
				onClick={onStop}
				{...stylex.props(styles.stopButton)}
			>
				<IconStop size={12} {...stylex.props(styles.toolIcon)} />
				Stop
			</button>
		</div>
	);
});

const styles = stylex.create({
	root: {
		alignItems: "center",
		display: "flex",
		flexShrink: 0,
		gap: controlSize._2,
		justifyContent: "space-between",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._3,
		userSelect: "none",
	},
	toolIcon: {
		flexShrink: 0,
	},
	activityWrap: {
		position: "relative",
	},
	activityPill: {
		alignItems: "center",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		cursor: "default",
		display: "flex",
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		height: controlSize._6,
		paddingInline: controlSize._2_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color",
		transitionTimingFunction: motion.ease,
	},
	activityIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	activitySummary: {
		maxWidth: 150,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	activityCount: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	tabularText: {
		fontVariantNumeric: "tabular-nums",
	},
	activityPopover: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		bottom: "100%",
		boxShadow: shadow.popover,
		left: 0,
		marginBottom: controlSize._1,
		maxWidth: 320,
		minWidth: 240,
		overflow: "hidden",
		position: "absolute",
	},
	popoverHeader: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		justifyContent: "space-between",
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2_5,
		textTransform: "uppercase",
	},
	popoverList: {
		maxHeight: 200,
		overflowY: "auto",
	},
	popoverRow: {
		alignItems: "center",
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2_5,
	},
	popoverRowBorder: {
		borderBottomColor: color.borderSubtle,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
	},
	popoverSummary: {
		color: color.textSoft,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	liveDot: {
		backgroundColor: color.textMuted,
		borderRadius: radius.pill,
		flexShrink: 0,
		height: controlSize._1_5,
		width: controlSize._1_5,
	},
	idleStatus: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
	},
	idleText: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	stopButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "inline-flex",
		flexShrink: 0,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		height: controlSize._6,
		justifyContent: "center",
		paddingInline: controlSize._2_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color, transform",
		transitionTimingFunction: motion.ease,
		":active": {
			transform: "scale(0.97)",
		},
	},
});
