import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { project } from "@shared/lib/native.tsx";
import { skillsQuery } from "@skills/services/skillsApi.ts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import { projects } from "../../hooks/useProjects.tsx";
import { styles } from "./styles.ts";

export function AutomationContext(props: {
	context: string[];
	onContextChange: (value: string[]) => void;
	ownerPath: string;
	value: string[];
	onChange: (value: string[]) => void;
}) {
	const library = useBackgroundQuery(skillsQuery);
	const options = createMemo(() =>
		project("skillChoices", {
			local: projects.catalog()?.skillChoices ?? [],
			global: (library.data ?? []).map((skill) => [skill._id, skill.name]),
			ownerPath: props.ownerPath,
			selected: props.value,
		}),
	);
	return (
		<>
			<fieldset {...stylex.attrs(styles.form)}>
				<legend>Project context</legend>
				<For
					each={projects.catalog()?.resourceChoices ?? []}
					keyed={(item) => item[0]}
				>
					{(item) => (
						<label {...stylex.attrs(styles.row)}>
							<input
								type="checkbox"
								checked={props.context.includes(item()[0])}
								onChange={(event) => {
									const ids = props.context.filter((id) => id !== item()[0]);
									if (event.currentTarget.checked) ids.push(item()[0]);
									props.onContextChange(ids);
								}}
							/>
							{item()[1]}
						</label>
					)}
				</For>
			</fieldset>
			<fieldset {...stylex.attrs(styles.form)}>
				<legend>Skills</legend>
				{library.error && (
					<p role="status">Global skills could not be loaded.</p>
				)}
				<For each={options()} keyed={(skill) => skill.id}>
					{(skill) => (
						<label {...stylex.attrs(styles.row)}>
							<input
								type="checkbox"
								checked={props.value.includes(skill().id)}
								onChange={(event) => {
									const next = props.value.filter((id) => id !== skill().id);
									if (event.currentTarget.checked) next.push(skill().id);
									props.onChange(next);
								}}
							/>
							{skill().label}{" "}
							<span {...stylex.attrs(styles.muted)}>{skill().source}</span>
						</label>
					)}
				</For>
			</fieldset>
		</>
	);
}
