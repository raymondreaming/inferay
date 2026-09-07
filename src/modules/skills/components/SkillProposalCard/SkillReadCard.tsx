import * as stylex from "@stylexjs/stylex";
import type { SkillRead } from "../../../../../build/presentation/contracts/SkillRead.ts";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import { ariaValue, openSkills } from "../../../../shared/lib/dom.tsx";
import { styles } from "./styles.ts";
export function SkillReadCard(_props: { skill: SkillRead }) {
	return (
		<section
			aria-label={ariaValue(`Skill: ${_props.skill.name}`)}
			{...stylex.attrs(surfaceStyles.panel, styles.card)}
		>
			<div {...stylex.attrs(styles.heading)}>
				<strong>Skill found</strong>
				<code>/{_props.skill.command}</code>
			</div>
			<p {...stylex.attrs(styles.reason)}>
				{_props.skill.description || _props.skill.name}
			</p>
			<details>
				<summary>Instructions</summary>
				<pre {...stylex.attrs(styles.instructions)}>
					{_props.skill.promptTemplate}
				</pre>
			</details>
			<div {...stylex.attrs(styles.actions)}>
				<button
					type="button"
					onClick={() =>
						openSkills({
							mode: "edit",
							skillId: _props.skill._id,
						})
					}
					{...stylex.attrs(styles.button)}
				>
					{_props.skill.isBuiltIn ? "View skill" : "Edit skill"}
				</button>
			</div>
		</section>
	);
}
