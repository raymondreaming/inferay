import { color, controlSize, font, radius } from "@design-system/styles.stylex.ts";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import { IconStop } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";
import type { AgentsStatusState } from "../AgentChatView/useChatConnection.tsx";

const styles = stylex.create({
	bar: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		marginBottom: controlSize._1,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		borderRadius: radius.md,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.accentBorder,
		backgroundColor: color.backgroundRaised,
		color: color.textSoft,
		fontSize: font.size_2_75,
	},
	row: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: controlSize._2,
	},
	meta: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	actions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
	},
});

export function SubagentIndicator(props: {
	status: AgentsStatusState;
	onCancel: (id: string) => void;
}) {
	return (
		<Show when={props.status.enabled && props.status.active > 0}>
			<div {...stylex.attrs(styles.bar)}>
				<div {...stylex.attrs(styles.row)}>
					<span {...stylex.attrs(styles.meta)}>
						{props.status.active} subagent
						{props.status.active === 1 ? "" : "s"} running
					</span>
					<IconButton
						type="button"
						variant="ghost"
						size="sm"
						title="Cancel all subagents"
						onClick={() => props.onCancel("all")}
					>
						<IconStop size={12} />
					</IconButton>
				</div>
				<For
					each={props.status.workers.filter(
						(worker) => worker.status === "running",
					)}
				>
					{(worker) => (
						<div {...stylex.attrs(styles.row)}>
							<span {...stylex.attrs(styles.meta)}>
								{worker.title} · {worker.profile}
							</span>
							<div {...stylex.attrs(styles.actions)}>
								<IconButton
									type="button"
									variant="ghost"
									size="sm"
									title={`Cancel ${worker.title}`}
									onClick={() => props.onCancel(worker.id)}
								>
									<IconStop size={12} />
								</IconButton>
							</div>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}
