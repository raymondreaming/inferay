import * as stylex from "@octanejs/stylex";
import { memo, useSyncExternalStore } from "octane";
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
} from "../../tokens.stylex.ts";
import { ThinkingIndicator } from "../ui/DotMatrixLoader.tsx";
import { IconStop } from "../ui/Icons.tsx";

interface AgentChatStatusBarProps {
	isLoading: boolean;
	startTime?: number | null;
	onStop: () => void;
}

export const AgentChatStatusBar = memo(function AgentChatStatusBar({
	isLoading,
	startTime,
	onStop,
}: AgentChatStatusBarProps) {
	const connectionStatus = useSyncExternalStore(
		subscribeWebSocketStatus,
		getWebSocketStatus,
		getWebSocketStatus,
	);
	if (!isLoading && connectionStatus === "connected") return null;

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
				<div {...stylex.props(styles.activity)}>
					{startTime ? <ThinkingIndicator startTime={startTime} /> : null}
				</div>
			)}

			{isLoading && (
				<button
					type="button"
					onClick={onStop}
					title="Stop generation"
					aria-label="Stop generation"
					{...stylex.props(styles.stopButton)}
				>
					<IconStop size={12} {...stylex.props(styles.toolIcon)} />
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
	activity: {
		flex: 1,
		minWidth: 0,
		alignItems: "center",
		display: "flex",
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
		paddingInline: 0,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color, transform",
		transitionTimingFunction: motion.ease,
		":active": {
			transform: "scale(0.97)",
		},
		width: controlSize._6,
	},
});
