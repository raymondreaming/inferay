import * as stylex from "@octanejs/stylex";
import { DotMatrixRipple } from "../../../../shared/ui/DotMatrixLoader/index.tsx";
import type { CommandSystemMessage } from "../../model/agent-chat-shared.ts";
import { styles } from "./styles.ts";

export function CommandSystemCard({
	command,
}: {
	command: CommandSystemMessage;
}) {
	const commandLabel = `/${command.name}${command.args ? ` ${command.args}` : ""}`;
	return (
		<div {...stylex.props(styles.goalCard, styles.goalCardActive)}>
			<span {...stylex.props(styles.goalIconSlot, styles.goalIconActive)}>
				<DotMatrixRipple
					dotSize={1.35}
					gap={1}
					speed={1.1}
					ariaLabel="Command running"
				/>
			</span>
			<div {...stylex.props(styles.goalCardBody)}>
				<div {...stylex.props(styles.goalCardHeader)}>
					<span {...stylex.props(styles.goalCardTitle)}>Running Command</span>
				</div>
				<div {...stylex.props(styles.commandObjective)}>{commandLabel}</div>
				{command.description && (
					<div {...stylex.props(styles.goalDetail)}>{command.description}</div>
				)}
			</div>
		</div>
	);
}
