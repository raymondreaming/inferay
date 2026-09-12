import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Show } from "solid-js";
import type { ToolDisplayInfo } from "../../../../../build/presentation/contracts/ToolDisplayInfo.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconChevronDown } from "../../../../shared/ui/Icons/index.tsx";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { CopyButton } from "../ChatRichContent/index.tsx";
import { McpSourceMark } from "./McpSourceMark.tsx";
import { styles } from "./styles.ts";
import { ToolOutputHighlight } from "./ToolOutputHighlight.tsx";
export function ToolTimeline(_props: {
	tools: ChatMessage[];
	expandedTools: Set<string>;
	onToggle: (id: string) => void;
	continuesAfter?: boolean;
}) {
	return (
		<div {...stylex.attrs(styles.toolTimeline)}>
			{
				<For each={_props.tools} keyed={(row) => row.id}>
					{(tool, index) => {
						const collapsed = createMemo(
							() => !_props.expandedTools.has(tool().id),
						);
						const display = createMemo(() =>
							getToolDisplayInfo(tool().toolName, tool().render?.display),
						);
						return (
							<div {...stylex.attrs(styles.toolMilestone)}>
								<span
									aria-hidden="true"
									{...stylex.attrs(
										styles.toolMilestoneNode,
										index() === _props.tools.length - 1 &&
											!(_props.continuesAfter === undefined
												? false
												: _props.continuesAfter) &&
											styles.toolMilestoneNodeLast,
									)}
								/>
								<div {...stylex.attrs(styles.toolMilestoneBody)}>
									<button
										type="button"
										onClick={() => _props.onToggle(tool().id)}
										title={
											collapsed()
												? "Show command details"
												: "Hide command details"
										}
										{...stylex.attrs(styles.toolMilestoneToggle)}
									>
										<Show when={display().source}>
											{(source) => <McpSourceMark source={source()} />}
										</Show>
										<span {...stylex.attrs(styles.toolMilestoneLabel)}>
											{display().label}
										</span>
										{display().detail && (
											<span
												title={display().detail}
												{...stylex.attrs(styles.toolMilestoneDetail)}
											>
												{display().detail}
											</span>
										)}
										<IconChevronDown
											size={iconSize.xs}
											{...stylex.attrs(
												styles.toolMilestoneChevron,
												collapsed() && styles.rotateClosed,
											)}
										/>
									</button>
									{!collapsed() && tool().content && (
										<div {...stylex.attrs(styles.toolOutputWrap)}>
											<pre {...stylex.attrs(styles.toolOutput)}>
												<ToolOutputHighlight
													render={tool().render}
													content={tool().content}
												/>
											</pre>
											<div {...stylex.attrs(styles.toolCopyOverlay)}>
												<CopyButton text={tool().content} />
											</div>
										</div>
									)}
								</div>
							</div>
						);
					}}
				</For>
			}
		</div>
	);
}
export function getToolDisplayInfo(
	toolName: string | undefined,
	nativeDisplay?: ToolDisplayInfo,
): ToolDisplayInfo {
	return (
		nativeDisplay ?? {
			label: toolName ? `Using ${toolName}` : "Running tool",
		}
	);
}
