import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import { iconSize } from "../../../design-system.ts";
import { ThinkingIndicator } from "../../../shared/ui/DotMatrixLoader.tsx";
import { IconStop } from "../../../shared/ui/Icons.tsx";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../../tokens.stylex.ts";

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
	if (!isLoading) return null;

	return (
		<div {...stylex.props(styles.root)}>
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
					<IconStop size={iconSize.md} {...stylex.props(styles.toolIcon)} />
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
		minWidth: controlSize._0,
		alignItems: "center",
		display: "flex",
		height: controlSize._6,
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
		paddingInline: controlSize._0,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, color, transform",
		transitionTimingFunction: motion.ease,
		":active": {
			transform: "scale(0.97)",
		},
		width: controlSize._6,
	},
});
