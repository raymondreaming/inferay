import * as stylex from "@octanejs/stylex";
import { readStoredValue } from "../../../../adapters/storage/stored-values.ts";
import {
	iconSize,
	selectionAppearance,
} from "../../../../design-system/styles.stylex.ts";
import { IconAgent, IconX } from "../../../../shared/ui/Icons/index.tsx";
import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import { isChatAgentKind } from "../../../agents/model/agents.ts";
import {
	type AgentPaneModel,
	dispatchRemoveAgentPaneRequest,
} from "../../model/workspace-model.ts";
import { styles } from "./styles.ts";

export function PaneSummaryItem({
	pane,
	isActive,
	onClick,
}: {
	pane: AgentPaneModel;
	isActive: boolean;
	onClick: () => void;
}) {
	const isChat = isChatAgentKind(pane.agentKind);
	const summary = isChat
		? (pane.summary ?? readStoredValue(`inferay-chat-summary-${pane.id}`))
		: null;
	const primaryLabel = isChat ? (summary ?? pane.title) : pane.title;
	return (
		<div {...stylex.props(styles.paneSummaryCard)}>
			<button
				type="button"
				onClick={onClick}
				{...stylex.props(
					styles.paneSummary,
					...selectionAppearance("list", isActive),
				)}
			>
				<span {...stylex.props(styles.paneSummaryIcon)}>
					{isChat ? (
						getAgentIcon(
							pane.agentKind,
							12,
							stylex.props(styles.iconDim).className,
						)
					) : (
						<IconAgent
							size={iconSize.md}
							className={stylex.props(styles.iconDim).className}
						/>
					)}
				</span>
				<div {...stylex.props(styles.paneSummaryText)}>
					<p {...stylex.props(styles.paneSummaryTitle)}>{primaryLabel}</p>
				</div>
			</button>
			<button
				type="button"
				onClick={() => dispatchRemoveAgentPaneRequest(pane.id)}
				{...stylex.props(styles.paneSummaryDelete)}
				title="Delete pane"
				aria-label={`Delete ${primaryLabel}`}
			>
				<IconX size={iconSize.xs} />
			</button>
		</div>
	);
}
