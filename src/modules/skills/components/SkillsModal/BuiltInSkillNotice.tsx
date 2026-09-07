import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconCopy } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function BuiltInSkillNotice({
	duplicateSelected,
}: {
	duplicateSelected: () => void;
}) {
	return (
		<div {...stylex.props(styles.builtInNotice)}>
			<span>Built-in workflow · Read-only</span>
			<button
				type="button"
				onClick={duplicateSelected}
				{...stylex.props(styles.copyButton)}
			>
				<IconCopy size={iconSize.sm} /> Make a copy
			</button>
		</div>
	);
}
