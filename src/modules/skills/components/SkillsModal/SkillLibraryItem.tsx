import * as stylex from "@stylexjs/stylex";
import type { Prompt } from "../../../../../build/presentation/contracts/Prompt.ts";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../shared/lib/dom.tsx";
import { styles } from "./styles.ts";
export function SkillLibraryItem(_props: {
	skill: Prompt;
	active: boolean;
	selectSkill: (skill: Prompt) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => _props.selectSkill(_props.skill)}
			aria-current={ariaValue(_props.active ? "true" : undefined)}
			title={_props.skill.description || _props.skill.name}
			{...stylex.attrs(
				styles.skillRow,
				_props.active && surfaceStyles.panel,
				_props.active && styles.skillRowActive,
			)}
		>
			<span {...stylex.attrs(styles.skillCopy)}>
				<span {...stylex.attrs(styles.skillCommand)}>
					/{_props.skill.command}
				</span>
				<span {...stylex.attrs(styles.skillDescription)}>
					{_props.skill.description || _props.skill.name}
				</span>
			</span>
			{_props.skill.isBuiltIn && (
				<span {...stylex.attrs(styles.builtinLabel)}>Built-in</span>
			)}
		</button>
	);
}
