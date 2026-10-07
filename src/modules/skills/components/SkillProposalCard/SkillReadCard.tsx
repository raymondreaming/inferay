import type { SkillRead } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { ariaValue, openSkills } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import * as stylex from "@stylexjs/stylex";
export function SkillReadCard(props: { skill: SkillRead }) {
	return (
		<section
			aria-label={ariaValue(`Skill: ${props.skill.name}`)}
			{...stylex.attrs(surfaceStyles.panel, cardStyles.card)}
		>
			<div {...stylex.attrs(cardStyles.header)}>
				<div {...stylex.attrs(cardStyles.heading)}>
					<div {...stylex.attrs(cardStyles.title)}>{props.skill.name}</div>
					<p {...stylex.attrs(cardStyles.status)}>
						Global skill · /{props.skill.command}
					</p>
				</div>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => openSkills({ mode: "edit", skillId: props.skill._id })}
				>
					{props.skill.isBuiltIn ? "View skill" : "Edit skill"}
				</Button>
			</div>
			<div {...stylex.attrs(cardStyles.metadata)}>
				{props.skill.description}
			</div>
			<CardInstructions text={props.skill.promptTemplate} />
		</section>
	);
}
