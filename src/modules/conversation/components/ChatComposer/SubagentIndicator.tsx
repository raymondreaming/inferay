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
	failed: {
		color: color.textMuted,
		whiteSpace: "normal",
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
	const running = () =>
		props.status.workers.filter((worker) => worker.status === "running");
	const failed = () =>
		props.status.workers.filter(
			(worker) =>
				worker.status === "failed" || worker.status === "cancelled",
		);
	return (
		<Show when={props.status.enabled}>
			<div {...stylex.attrs(styles.bar)}>
				<div {...stylex.attrs(styles.row)}>
					<span {...stylex.attrs(styles.meta)}>
						{props.status.active > 0
							? `${props.status.active} subagent${props.status.active === 1 ? "" : "s"} running`
							: "Subagents on · /agents help"}
					</span>
					<Show when={props.status.active > 0}>
						<IconButton
							type="button"
							variant="ghost"
							size="sm"
							title="Cancel all subagents"
							onClick={() => props.onCancel("all")}
						>
							<IconStop size={12} />
						</IconButton>
					</Show>
				</div>
				<For each={running()}>
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
				<For each={failed().slice(0, 2)}>
					{(worker) => (
						<div {...stylex.attrs(styles.row)}>
							<span {...stylex.attrs(styles.meta, styles.failed)}>
								{worker.title} · {worker.status}
								{worker.detail ? ` — ${worker.detail}` : ""}
							</span>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}
