import * as stylex from "@octanejs/stylex";
import { surfaceStyles } from "../../../../design-system/styles.stylex.ts";
import type { SkillRead } from "../../model/skill-library.ts";
import { openSkills } from "../../model/skill-library.ts";
import { styles } from "./styles.ts";

export function SkillReadCard({ skill }: { skill: SkillRead }) {
	return (
		<section
			aria-label={`Skill: ${skill.name}`}
			{...stylex.props(surfaceStyles.panel, styles.card)}
		>
			<div {...stylex.props(styles.heading)}>
				<strong>Skill found</strong>
				<code>/{skill.command}</code>
			</div>
			<p {...stylex.props(styles.reason)}>{skill.description || skill.name}</p>
			<details>
				<summary>Instructions</summary>
				<pre {...stylex.props(styles.instructions)}>{skill.promptTemplate}</pre>
			</details>
			<div {...stylex.props(styles.actions)}>
				<button
					type="button"
					onClick={() => openSkills({ mode: "edit", skillId: skill._id })}
					{...stylex.props(styles.button)}
				>
					{skill.isBuiltIn ? "View skill" : "Edit skill"}
				</button>
			</div>
		</section>
	);
}
