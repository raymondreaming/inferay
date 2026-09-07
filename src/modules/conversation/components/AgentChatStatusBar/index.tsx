import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { ThinkingIndicator } from "../../../../shared/ui/DotMatrixLoader/index.tsx";
import { IconStop } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

interface AgentChatStatusBarProps {
	isLoading: boolean;
	startTime?: number | null;
	onStop: () => void;
}
export const AgentChatStatusBar = function AgentChatStatusBar(
	_props: AgentChatStatusBarProps,
) {
	return (
		<>
			{(() => {
				if (!_props.isLoading) return null;
				return (
					<div {...stylex.attrs(styles.root)}>
						{_props.isLoading && (
							<div {...stylex.attrs(styles.activity)}>
								{_props.startTime ? (
									<ThinkingIndicator startTime={_props.startTime} />
								) : null}
							</div>
						)}

						{_props.isLoading && (
							<button
								type="button"
								onClick={_props.onStop}
								title="Stop generation"
								aria-label="Stop generation"
								{...stylex.attrs(styles.stopButton)}
							>
								<IconStop
									size={iconSize.md}
									{...stylex.attrs(styles.toolIcon)}
								/>
							</button>
						)}
					</div>
				);
			})()}
		</>
	);
};
