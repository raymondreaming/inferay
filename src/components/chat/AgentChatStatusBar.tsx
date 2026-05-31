import * as stylex from "@stylexjs/stylex";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage } from "../../features/chat/agent-chat-shared.ts";
import {
	color,
	controlSize,
	effect,
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
import {
	extractToolActivities,
	getStatusToolName,
	normalizeToolName,
	type ToolActivity,
} from "./chat-agent-utils.ts";

const APP_REGION_NO_DRAG_CLASS = "electrobun-webkit-app-region-no-drag";

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
	const [isPopoverHovered, setIsPopoverHovered] = useState(false);
	const activityButtonRef = useRef<HTMLButtonElement>(null);
	const [popoverPosition, setPopoverPosition] = useState({
		bottom: 0,
		left: 0,
		maxHeight: 260,
		placement: "top" as "top" | "bottom",
		top: 0,
		width: 260,
	});
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
	const showActivityPopover =
		(isHovered || isPopoverHovered) && activityCount > 0;

	useEffect(() => {
		if (!showActivityPopover) return;
		const updatePosition = () => {
			const rect = activityButtonRef.current?.getBoundingClientRect();
			if (!rect) return;
			const width = 260;
			const gap = 6;
			const spaceAbove = rect.top - gap;
			const spaceBelow = window.innerHeight - rect.bottom - gap;
			const placeAbove = spaceAbove >= 160 || spaceAbove >= spaceBelow;
			const maxHeight = Math.max(
				120,
				Math.min(260, (placeAbove ? spaceAbove : spaceBelow) - 8)
			);
			setPopoverPosition({
				bottom: placeAbove ? window.innerHeight - rect.top + gap : 0,
				left: Math.min(
					Math.max(8, rect.left),
					Math.max(8, window.innerWidth - width - 8)
				),
				maxHeight,
				placement: placeAbove ? "top" : "bottom",
				top: placeAbove ? 0 : rect.bottom + gap,
				width,
			});
		};
		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [showActivityPopover]);
	const activityPopoverProps = stylex.props(styles.activityPopover);

	return (
		<div {...stylex.props(styles.root)}>
			{hasActivity ? (
				<div
					{...stylex.props(styles.activityWrap)}
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
				>
					<button
						ref={activityButtonRef}
						type="button"
						onClick={onStop}
						{...stylex.props(styles.activityStopButton)}
						className={`${APP_REGION_NO_DRAG_CLASS} ${stylex.props(styles.activityStopButton).className ?? ""}`}
					>
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
						<span {...stylex.props(styles.activityDivider)} />
						<IconStop size={12} {...stylex.props(styles.toolIcon)} />
						<span {...stylex.props(styles.stopLabel)}>Stop</span>
					</button>
				</div>
			) : (
				<div {...stylex.props(styles.idleStatus)}>
					<span {...stylex.props(styles.liveDot)} />
					<span {...stylex.props(styles.idleText)}>Working...</span>
				</div>
			)}
			{showActivityPopover &&
				createPortal(
					<div
						{...activityPopoverProps}
						className={`${APP_REGION_NO_DRAG_CLASS} ${activityPopoverProps.className ?? ""}`}
						onMouseEnter={() => setIsPopoverHovered(true)}
						onMouseLeave={() => setIsPopoverHovered(false)}
						style={{
							bottom:
								popoverPosition.placement === "top"
									? popoverPosition.bottom
									: undefined,
							left: popoverPosition.left,
							maxHeight: popoverPosition.maxHeight,
							top:
								popoverPosition.placement === "bottom"
									? popoverPosition.top
									: undefined,
							width: popoverPosition.width,
						}}
					>
						<div {...stylex.props(styles.popoverHeader)}>
							<span>Activity</span>
							<span {...stylex.props(styles.tabularText)}>{activityCount}</span>
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
					</div>,
					document.body
				)}
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
		minWidth: 0,
		position: "relative",
	},
	activityStopButton: {
		alignItems: "center",
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.borderSubtle,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 0.5,
		color: color.textSoft,
		cursor: "pointer",
		display: "flex",
		flexShrink: 1,
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		height: controlSize._6,
		maxWidth: "100%",
		minWidth: 0,
		paddingInline: controlSize._2_5,
		boxShadow: shadow.controlDepth,
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, background-image, border-color, box-shadow, color, transform",
		transitionTimingFunction: motion.ease,
		":active": {
			transform: "scale(0.98)",
		},
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
	activityDivider: {
		backgroundColor: color.border,
		flexShrink: 0,
		height: controlSize._3,
		width: 1,
	},
	stopLabel: {
		flexShrink: 0,
	},
	tabularText: {
		fontVariantNumeric: "tabular-nums",
	},
	activityPopover: {
		backdropFilter: "blur(24px)",
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.popoverDepth,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow:
			"inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 28px 58px -14px rgba(0, 0, 0, 0.82)",
		display: "flex",
		flexDirection: "column",
		maxWidth: 320,
		minWidth: 240,
		overflow: "hidden",
		position: "fixed",
		zIndex: 240,
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
		overflowY: "auto",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	popoverRow: {
		alignItems: "center",
		backgroundColor: {
			default: "transparent",
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: 30,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
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
});
