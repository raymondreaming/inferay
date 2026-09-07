import * as stylex from "@stylexjs/stylex";
import { DotMatrixRipple } from "../../../../shared/ui/DotMatrixLoader/index.tsx";
import { styles } from "./styles.ts";
export function CommandSystemCard(_props: { command: CommandSystemMessage }) {
	const commandLabel = () =>
		`/${_props.command.name}${_props.command.args ? ` ${_props.command.args}` : ""}`;
	return (
		<div {...stylex.attrs(styles.goalCard, styles.goalCardActive)}>
			<span {...stylex.attrs(styles.goalIconSlot, styles.goalIconActive)}>
				<DotMatrixRipple
					dotSize={1.35}
					gap={1}
					speed={1.1}
					ariaLabel="Command running"
				/>
			</span>
			<div {...stylex.attrs(styles.goalCardBody)}>
				<div {...stylex.attrs(styles.goalCardHeader)}>
					<span {...stylex.attrs(styles.goalCardTitle)}>Running Command</span>
				</div>
				<div {...stylex.attrs(styles.commandObjective)}>{commandLabel()}</div>
				{_props.command.description && (
					<div {...stylex.attrs(styles.goalDetail)}>
						{_props.command.description}
					</div>
				)}
			</div>
		</div>
	);
}
export type CommandSystemMessage = {
	type: "inferay.command";
	name: string;
	description?: string;
	args?: string;
};
