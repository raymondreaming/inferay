import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { IconCopy } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function BuiltInSkillNotice(_props: { duplicateSelected: () => void }) {
	return (
		<div {...stylex.attrs(styles.builtInNotice)}>
			<span>Built-in workflow · Read-only</span>
			<button
				type="button"
				onClick={_props.duplicateSelected}
				{...stylex.attrs(styles.copyButton)}
			>
				<IconCopy size={iconSize.sm} /> Make a copy
			</button>
		</div>
	);
}
