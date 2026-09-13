import { iconSize } from "@design-system/styles.stylex.ts";
import { ThinkingIndicator } from "@shared/ui/DotMatrixLoader/index.tsx";
import { IconStop } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";

export const AgentChatStatusBar = function AgentChatStatusBar(props: {
	active?: boolean;
	isLoading: boolean;
	startTime?: number | null;
	onStop: () => void;
}) {
	return (
		<>
			{(() => {
				if (!props.isLoading) return null;
				return (
					<div data-chat-activity {...stylex.attrs(styles.root)}>
						{props.isLoading && (
							<div {...stylex.attrs(styles.activity)}>
								{props.startTime ? (
									<ThinkingIndicator
										active={props.active}
										startTime={props.startTime}
									/>
								) : null}
							</div>
						)}

						{props.isLoading && (
							<button
								type="button"
								onClick={props.onStop}
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
