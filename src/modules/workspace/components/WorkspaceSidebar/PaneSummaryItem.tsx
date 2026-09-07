import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { Pane } from "../../../../../build/presentation/contracts/Pane.ts";
import {
	iconSize,
	selectionAppearance,
} from "../../../../design-system/styles.stylex.ts";
import {
	ariaValue,
	dispatchRemoveAgentPaneRequest,
} from "../../../../shared/lib/dom.tsx";
import {
	isChatAgentKind,
	readStoredValue,
} from "../../../../shared/lib/native.tsx";
import { IconAgent, IconX } from "../../../../shared/ui/Icons/index.tsx";
import { getAgentIcon } from "../../../agents/components/AgentIcon/index.tsx";
import { styles } from "./styles.ts";
export function PaneSummaryItem(_props: {
	pane: Pane;
	isActive: boolean;
	onClick: () => void;
}) {
	const isChat = createMemo(() => isChatAgentKind(_props.pane.agentKind));
	const summary = createMemo(() =>
		isChat()
			? (_props.pane.summary ??
				readStoredValue(`inferay-chat-summary-${_props.pane.id}`))
			: null,
	);
	const primaryLabel = createMemo(() =>
		isChat() ? (summary() ?? _props.pane.title) : _props.pane.title,
	);
	return (
		<div {...stylex.attrs(styles.paneSummaryCard)}>
			<button
				type="button"
				onClick={_props.onClick}
				{...stylex.attrs(
					styles.paneSummary,
					...selectionAppearance("list", _props.isActive),
				)}
			>
				<span {...stylex.attrs(styles.paneSummaryIcon)}>
					{isChat() ? (
						getAgentIcon(
							_props.pane.agentKind,
							12,
							stylex.attrs(styles.iconDim).class,
						)
					) : (
						<IconAgent
							size={iconSize.md}
							class={stylex.attrs(styles.iconDim).class}
						/>
					)}
				</span>
				<div {...stylex.attrs(styles.paneSummaryText)}>
					<p {...stylex.attrs(styles.paneSummaryTitle)}>{primaryLabel()}</p>
				</div>
			</button>
			<button
				type="button"
				onClick={() => dispatchRemoveAgentPaneRequest(_props.pane.id)}
				{...stylex.attrs(styles.paneSummaryDelete)}
				title="Delete pane"
				aria-label={ariaValue(`Delete ${primaryLabel()}`)}
			>
				<IconX size={iconSize.xs} />
			</button>
		</div>
	);
}
