import * as stylex from "@stylexjs/stylex";
import { memo } from "react";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { IconCircle, IconRobot, IconX } from "../../components/ui/Icons.tsx";
import type { ClaudeProcess } from "../../features/agents/useClaudeProcesses.ts";
import { basename, formatKilobytes } from "../../lib/format.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { CollapsibleSidebarSection } from "./CollapsibleSidebarSection.tsx";

function formatElapsed(elapsed: string): string {
	// ps etime format: [[dd-]hh:]mm:ss
	const parts = elapsed.trim().split(/[-:]/);
	if (parts.length === 2) return `${parts[0]}m`;
	if (parts.length === 3) return `${parts[0]}h ${parts[1]}m`;
	if (parts.length === 4) return `${parts[0]}d ${parts[1]}h`;
	return elapsed;
}

export const ClaudeProcessesSidebar = memo(function ClaudeProcessesSidebar({
	processes,
	onKillProcess,
	onKillAll,
	expanded,
	onToggle,
}: {
	processes: ClaudeProcess[];
	onKillProcess: (pid: number) => void;
	onKillAll: () => void;
	expanded: boolean;
	onToggle: () => void;
}) {
	const totalRss = processes.reduce((sum, p) => sum + p.rss, 0);
	return (
		<CollapsibleSidebarSection
			icon={<IconRobot size={12} />}
			label="Processes"
			count={processes.length}
			countColor={
				processes.length > 5
					? "text-red-400"
					: processes.length > 0
						? "text-amber-400"
						: "text-inferay-muted-gray"
			}
			expanded={expanded}
			onToggle={onToggle}
			emptyMessage="No Claude processes running"
		>
			{processes.length > 0 && (
				<div {...stylex.props(styles.summary)}>
					<span {...stylex.props(styles.metaText)}>
						{processes.length} process{processes.length !== 1 ? "es" : ""} ·{" "}
						{formatKilobytes(totalRss)}
					</span>
					{processes.length > 1 && (
						<button
							type="button"
							onClick={onKillAll}
							{...stylex.props(styles.killAll)}
						>
							Kill All
						</button>
					)}
				</div>
			)}
			{processes.map((p) => (
				<div key={p.pid} {...stylex.props(styles.row)}>
					<div {...stylex.props(styles.statusSlot)}>
						<IconCircle
							size={8}
							{...stylex.props(
								styles.statusDot,
								p.cpu > 10
									? styles.statusHigh
									: p.cpu > 2
										? styles.statusMedium
										: styles.statusLow
							)}
						/>
					</div>
					<div {...stylex.props(styles.content)}>
						<p {...stylex.props(styles.title)} title={p.cwd || `PID ${p.pid}`}>
							{p.cwd ? basename(p.cwd) : "unknown"}
						</p>
						<p {...stylex.props(styles.metaText, styles.truncate)}>
							{p.cpu}% CPU · {formatKilobytes(p.rss)} ·{" "}
							{formatElapsed(p.elapsed)}
						</p>
					</div>
					<IconButton
						variant="danger"
						size="xs"
						onClick={() => onKillProcess(p.pid)}
						title={`Kill PID ${p.pid}`}
						className={stylex.props(styles.killButton).className}
					>
						<IconX size={10} />
					</IconButton>
				</div>
			))}
		</CollapsibleSidebarSection>
	);
});

const styles = stylex.create({
	summary: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: controlSize._1,
		borderRadius: "0.375rem",
		backgroundColor: "rgba(255, 255, 255, 0.04)",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
	},
	metaText: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	killAll: {
		color: {
			default: color.danger,
			":hover": "#fca5a5",
		},
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		transitionProperty: "color",
		transitionDuration: "120ms",
	},
	row: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		gap: controlSize._2,
		marginBottom: "0.125rem",
		borderRadius: "0.375rem",
		paddingBlock: "0.375rem",
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionProperty: "background-color",
		transitionDuration: "120ms",
		backgroundColor: {
			default: "transparent",
			":hover": color.backgroundRaised,
		},
	},
	statusSlot: {
		flexShrink: 0,
	},
	statusDot: {
		fill: "currentColor",
	},
	statusHigh: {
		color: color.danger,
	},
	statusMedium: {
		color: "#fbbf24",
	},
	statusLow: {
		color: "var(--color-inferay-accent)",
	},
	content: {
		minWidth: 0,
		flex: 1,
	},
	title: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
	},
	truncate: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	killButton: {
		flexShrink: 0,
	},
});
