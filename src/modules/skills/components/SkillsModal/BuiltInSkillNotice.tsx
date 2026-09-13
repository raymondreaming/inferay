import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { IconCopy } from "../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function BuiltInSkillNotice(_props: { duplicateSelected: () => void }) {
	return (
		<div {...stylex.attrs(styles.builtInNotice)}>
			<span>Built-in workflow · Read-only</span>
			<Button
				liquid={false}
				type="button"
				variant="ghost"
				size="sm"
				onClick={_props.duplicateSelected}
			>
				<IconCopy size={iconSize.md} />
				<span>Make a copy</span>
			</Button>
		</div>
	);
}
