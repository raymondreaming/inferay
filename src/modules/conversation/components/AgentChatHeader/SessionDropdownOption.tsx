import * as stylex from "@octanejs/stylex";
import type { DropdownOption } from "../../../../shared/ui/DropdownButton/index.tsx";
import { styles } from "./styles.ts";

export function SessionDropdownOption({
	option,
	isSelected,
}: {
	option: DropdownOption;
	isSelected: boolean;
}) {
	return (
		<div
			{...stylex.props(
				styles.sessionOption,
				isSelected && styles.sessionOptionSelected,
			)}
		>
			<span {...stylex.props(styles.sessionOptionIcon)}>{option.icon}</span>
			<div {...stylex.props(styles.sessionOptionText)}>
				<span {...stylex.props(styles.sessionOptionRepo)}>{option.label}</span>
				<span {...stylex.props(styles.sessionOptionTitle)}>
					{option.detail}
				</span>
			</div>
		</div>
	);
}
