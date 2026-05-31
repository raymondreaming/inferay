import * as stylex from "@stylexjs/stylex";
import type { AgentAccountProviderStatus } from "../../features/agents/agent-account-status.ts";
import { getAgentIcon } from "../../features/agents/agent-ui.tsx";
import { color, controlSize, font } from "../../tokens.stylex.ts";

export function ProfileAgentAccountCard({
	status,
}: {
	status: AgentAccountProviderStatus;
}) {
	const healthLabel =
		status.health === "ready"
			? "Ready"
			: status.health === "needs-login"
				? "Login needed"
				: "Missing";
	return (
		<div {...stylex.props(styles.agentAccountCard)}>
			<div {...stylex.props(styles.agentAccountHeader)}>
				<span {...stylex.props(styles.agentAccountIdentity)}>
					{getAgentIcon(status.kind, 14)}
					<span {...stylex.props(styles.agentAccountName)}>{status.label}</span>
				</span>
				<span
					{...stylex.props(
						styles.agentAccountPill,
						status.health === "ready"
							? styles.agentAccountReady
							: status.health === "needs-login"
								? styles.agentAccountNeedsLogin
								: styles.agentAccountMissing
					)}
				>
					{healthLabel}
				</span>
			</div>
			<p {...stylex.props(styles.agentAccountSummary)}>{status.summary}</p>
			<div {...stylex.props(styles.agentAccountFacts)}>
				<span {...stylex.props(styles.agentAccountFact)}>
					<span {...stylex.props(styles.agentAccountFactLabel)}>Binary</span>
					<strong {...stylex.props(styles.agentAccountFactValue)}>
						{status.binaryPath}
					</strong>
				</span>
				<span {...stylex.props(styles.agentAccountFact)}>
					<span {...stylex.props(styles.agentAccountFactLabel)}>Version</span>
					<strong {...stylex.props(styles.agentAccountFactValue)}>
						{status.version ?? "Unknown"}
					</strong>
				</span>
				<span {...stylex.props(styles.agentAccountFact)}>
					<span {...stylex.props(styles.agentAccountFactLabel)}>
						Auth config
					</span>
					<strong {...stylex.props(styles.agentAccountFactValue)}>
						{status.authConfigPaths.length
							? `${status.authConfigPaths.length} found`
							: "Not found"}
					</strong>
				</span>
			</div>
			<div {...stylex.props(styles.agentAccountSignals)}>
				{status.usageSignals.map((signal) => (
					<span key={signal} {...stylex.props(styles.agentAccountSignal)}>
						{signal}
					</span>
				))}
			</div>
		</div>
	);
}

const styles = stylex.create({
	agentAccountCard: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._3,
		minWidth: 0,
		paddingBlock: controlSize._1,
	},
	agentAccountHeader: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
		justifyContent: "space-between",
		minWidth: 0,
	},
	agentAccountIdentity: {
		alignItems: "center",
		color: color.textMain,
		display: "inline-flex",
		gap: controlSize._2,
		minWidth: 0,
	},
	agentAccountName: {
		fontSize: font.size_3,
		fontWeight: font.weight_6,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	agentAccountPill: {
		borderRadius: 999,
		borderStyle: "solid",
		borderWidth: 1,
		flexShrink: 0,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._0_5,
		paddingInline: controlSize._2,
	},
	agentAccountReady: {
		backgroundColor: color.successWash,
		borderColor: color.successBorder,
		color: color.success,
	},
	agentAccountNeedsLogin: {
		backgroundColor: color.warningWash,
		borderColor: color.warningBorder,
		color: color.warning,
	},
	agentAccountMissing: {
		backgroundColor: color.dangerWash,
		borderColor: color.dangerBorder,
		color: color.danger,
	},
	agentAccountSummary: {
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.45,
	},
	agentAccountFacts: {
		display: "grid",
		gap: controlSize._1,
	},
	agentAccountFact: {
		alignItems: "center",
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "5rem minmax(0, 1fr)",
		minWidth: 0,
	},
	agentAccountFactLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
	},
	agentAccountFactValue: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	agentAccountSignals: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
	},
	agentAccountSignal: {
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1.35,
	},
});
