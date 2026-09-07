import * as stylex from "@octanejs/stylex";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import { styles } from "./styles.ts";

export function SkillLibraryItem({
	skill,
	active,
	selectSkill,
}: {
	skill: Prompt;
	active: boolean;
	selectSkill: (skill: Prompt) => void;
}) {
	return (
		<button
			type="button"
			key={skill._id}
			onClick={() => selectSkill(skill)}
			aria-current={active ? "true" : undefined}
			title={skill.description || skill.name}
			{...stylex.props(
				styles.skillRow,
				active && surfaceStyles.panel,
				active && styles.skillRowActive,
			)}
		>
			<span {...stylex.props(styles.skillCopy)}>
				<span {...stylex.props(styles.skillCommand)}>/{skill.command}</span>
				<span {...stylex.props(styles.skillDescription)}>
					{skill.description || skill.name}
				</span>
			</span>
			{skill.isBuiltIn && (
				<span {...stylex.props(styles.builtinLabel)}>Built-in</span>
			)}
		</button>
	);
}
