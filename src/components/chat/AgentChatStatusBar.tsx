import * as stylex from "@octanejs/stylex";
import { memo, useEffect, useState, useSyncExternalStore } from "octane";
import type { ToolActivity } from "../../features/chat/agent-chat-shared.ts";
import {
	getWebSocketStatus,
	subscribeWebSocketStatus,
} from "../../lib/websocket.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";
import { ThinkingIndicator } from "../ui/DotMatrixLoader.tsx";
import {
	IconAgent,
	IconEye,
	IconFilePlus,
	IconGlobe,
	IconPencil,
	IconSearch,
	IconStop,
	IconWrench,
} from "../ui/Icons.tsx";
import { getStatusToolName, normalizeToolName } from "./chat-agent-utils.ts";

const MAX_STATUS_ACTIVITIES = 500;

interface AgentChatStatusBarProps {
	liveActivities?: ToolActivity[];
	isLoading: boolean;
	startTime?: number | null;
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
			return <IconAgent size={12} {...stylex.props(styles.toolIcon)} />;
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

function statusFallbackLabel(status: string) {
	if (status === "thinking") return "Planning next step";
	if (status === "responding") return "Writing response";
	return "Running";
}

export const AgentChatStatusBar = memo(function AgentChatStatusBar({
	liveActivities = [],
	isLoading,
	startTime,
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
	const connectionStatus = useSyncExternalStore(
		subscribeWebSocketStatus,
		getWebSocketStatus,
		getWebSocketStatus,
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
			const lastSequence = Number(
				prev[prev.length - 1]?.id.match(/-(\d+)$/)?.[1] ?? -1,
			);
			return [
				...prev,
				{
					id: `status-${statusToolName}-${lastSequence + 1}`,
					toolName: statusToolName,
					isStreaming: true,
					summary: statusToolName,
				},
			].slice(-MAX_STATUS_ACTIVITIES);
		});
	}, [isLoading, statusToolName]);

	if (!isLoading && connectionStatus === "connected") return null;
	const activityItems =
		liveActivities.length > 0 ? liveActivities : statusActivities;
	const latestActivity = activityItems[activityItems.length - 1];
	const displayToolName = latestActivity?.toolName ?? statusToolName;
	const displaySummary =
		latestActivity?.summary ?? statusToolName ?? statusFallbackLabel(status);
	const activityCount = activityItems.length;

	return (
		<div {...stylex.props(styles.root)}>
			{connectionStatus !== "connected" && (
				<div
					{...stylex.props(styles.connectionPill)}
					title="Messages stay queued until the app server reconnects"
				>
					<span {...stylex.props(styles.connectionDot)} />
					<span>
						{connectionStatus === "connecting"
							? "Connecting…"
							: "Offline — sends are queued"}
					</span>
				</div>
			)}
			{isLoading && (
				<div
					{...stylex.props(styles.activityWrap)}
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
				>
					<div {...stylex.props(styles.activityPill)}>
						{startTime ? <ThinkingIndicator startTime={startTime} /> : null}
						{displayToolName && (
							<span {...stylex.props(styles.activityIcon)}>
								<ToolStatusIcon toolName={displayToolName} />
							</span>
						)}
						<span
							title={displaySummary}
							{...stylex.props(styles.activitySummary)}
						>
							{displaySummary}
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
												: null,
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
			)}

			{isLoading && (
				<button
					type="button"
					onClick={onStop}
					{...stylex.props(styles.stopButton)}
				>
					<IconStop size={12} {...stylex.props(styles.toolIcon)} />
					Stop
				</button>
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
		flex: 1,
		minWidth: 0,
		position: "relative",
	},
	activityPill: {
		alignItems: "center",
		color: color.textSoft,
		cursor: "default",
		display: "flex",
		minWidth: 0,
		fontSize: font.size_3,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		height: controlSize._6,
	},
	connectionPill: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._1_5,
		height: controlSize._6,
		paddingInline: controlSize._2_5,
	},
	connectionDot: {
		backgroundColor: color.warning,
		borderRadius: "50%",
		height: 5,
		width: 5,
	},
	activityIcon: {
		color: color.textMuted,
		flexShrink: 0,
	},
	activitySummary: {
		flex: 1,
		minWidth: 0,
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
