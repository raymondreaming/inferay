import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { skillsQuery } from "@skills/services/skillsApi.ts";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { projects } from "../../hooks/useProjects.tsx";
import type { ProjectResource } from "../../model/projectFiles.ts";
import { styles } from "./styles.ts";

export function AutomationContext(props: {
	resources: ProjectResource[];
	context: string;
	onContextChange: (value: string) => void;
	projectId: string;
	ownerPath: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const library = useBackgroundQuery(skillsQuery);
	const selected = () =>
		props.value
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean);
	const options = () => {
		const catalog = projects.catalog();
		const globals = (library.data ?? []).map((skill) => ({
			id: `global:${skill._id}`,
			label: skill.name,
			source: "Global",
		}));
		const local = (catalog?.skills ?? []).flatMap((skill) => {
			if (skill.file.projectId !== props.projectId) return [];
			const own = skill.file.sourcePath.startsWith(
				`${props.ownerPath}/skills/`,
			);
			const plugin = catalog?.plugins.find(
				(item) =>
					item.file.projectId === props.projectId &&
					!item.file.error &&
					item.file.definition &&
					skill.file.sourcePath.startsWith(
						item.file.sourcePath.replace(/plugin\.json$/, ""),
					),
			);
			if (!own && !plugin?.file.definition) return [];
			const qualified = plugin?.file.definition
				? `plugin:${plugin.file.definition.id}:${skill.id}`
				: undefined;
			return [
				{
					id:
						qualified && (!own || selected().includes(qualified))
							? qualified
							: skill.id,
					label: skill.name,
					source: plugin?.file.definition?.name ?? "This automation",
				},
			];
		});
		const available = [...globals, ...local];
		return [
			...available,
			...selected()
				.filter((id) => !available.some((item) => item.id === id))
				.map((id) => ({ id, label: id, source: "Unavailable skill" })),
		];
	};
	return (
		<>
			<fieldset {...stylex.attrs(styles.form)}>
				<legend>Project context</legend>
				<For
					each={props.resources.filter((item) => !item.archived)}
					keyed={(item) => item.id}
				>
					{(item) => (
						<label {...stylex.attrs(styles.row)}>
							<input
								type="checkbox"
								checked={props.context
									.split(",")
									.map((id) => id.trim())
									.includes(item().id)}
								onChange={(event) => {
									const ids = props.context
										.split(",")
										.map((id) => id.trim())
										.filter((id) => id && id !== item().id);
									if (event.currentTarget.checked) ids.push(item().id);
									props.onContextChange(ids.join(", "));
								}}
							/>
							{item().name} · {item().type}
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
								checked={selected().includes(skill().id)}
								onChange={(event) => {
									const next = selected().filter((id) => id !== skill().id);
									if (event.currentTarget.checked) next.push(skill().id);
									props.onChange(next.join(", "));
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
