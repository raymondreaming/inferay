import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ThinkingIndicator } from "../../../../shared/ui/DotMatrixLoader/index.tsx";
import { IconStop } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

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
