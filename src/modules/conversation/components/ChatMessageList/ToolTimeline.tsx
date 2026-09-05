import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconChevronDown } from "../../../../shared/ui/Icons/index.tsx";
import {
	getToolDisplayInfo,
	type RenderChatMessage,
} from "../../model/agent-chat-shared.ts";
import { CopyButton } from "../ChatRichContent/index.tsx";
import { styles } from "./styles.ts";
import { ToolOutputHighlight } from "./ToolOutputHighlight.tsx";
export function ToolTimeline({
	tools,
	expandedTools,
	onToggle,
	continuesAfter = false,
}: {
	tools: RenderChatMessage[];
	expandedTools: Set<string>;
	onToggle: (id: string) => void;
	continuesAfter?: boolean;
}) {
	return (
		<div {...stylex.props(styles.toolTimeline)}>
			{tools.map((tool, index) => {
				const collapsed = !expandedTools.has(tool.id);
				const display = getToolDisplayInfo(tool.toolName, tool.render?.display);
				return (
					<div key={tool.id} {...stylex.props(styles.toolMilestone)}>
						<span
							aria-hidden="true"
							{...stylex.props(
								styles.toolMilestoneNode,
								index === tools.length - 1 &&
									!continuesAfter &&
									styles.toolMilestoneNodeLast,
							)}
						/>
						<div {...stylex.props(styles.toolMilestoneBody)}>
							<button
								type="button"
								onClick={() => onToggle(tool.id)}
								title={
									collapsed ? "Show command details" : "Hide command details"
								}
								{...stylex.props(styles.toolMilestoneToggle)}
							>
								<span {...stylex.props(styles.toolMilestoneLabel)}>
									{display.label}
								</span>
								{display.detail && (
									<span
										title={display.detail}
										{...stylex.props(styles.toolMilestoneDetail)}
									>
										{display.detail}
									</span>
								)}
								<IconChevronDown
									size={iconSize.xs}
									{...stylex.props(
										styles.toolMilestoneChevron,
										collapsed && styles.rotateClosed,
									)}
								/>
							</button>
							{!collapsed && tool.content && (
								<div {...stylex.props(styles.toolOutputWrap)}>
									<pre {...stylex.props(styles.toolOutput)}>
										<ToolOutputHighlight
											render={tool.render}
											content={tool.content}
										/>
									</pre>
									<div {...stylex.props(styles.toolCopyOverlay)}>
										<CopyButton text={tool.content} />
									</div>
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
