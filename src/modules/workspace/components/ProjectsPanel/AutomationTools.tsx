import type { AgentToolGrant } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { projects } from "../../hooks/useProjects.tsx";
import { styles } from "./styles.ts";

export function AutomationTools(props: {
	projectId: string;
	value: AgentToolGrant[];
	onChange: (value: AgentToolGrant[]) => void;
}) {
	const options = () =>
		(projects.catalog()?.plugins ?? [])
			.filter(
				(plugin) =>
					plugin.file.projectId === props.projectId &&
					plugin.file.definition &&
					!plugin.file.error,
			)
			.flatMap((plugin) => {
				const definition = plugin.file.definition!;
				const prefix = plugin.file.sourcePath.replace(/plugin\.json$/, "");
				return (projects.catalog()?.tools ?? [])
					.filter(
						(tool) =>
							tool.file.projectId === props.projectId &&
							tool.file.sourcePath.startsWith(prefix),
					)
					.map((tool) => ({
						pluginId: definition.id,
						toolId: tool.id,
						label: `${definition.name} · ${tool.name}`,
					}));
			});
	return (
		<fieldset {...stylex.attrs(styles.form)}>
			<legend>Library tools</legend>
			<p {...stylex.attrs(styles.muted)}>
				Selected tools are available to this agent through Inferay.
			</p>
			{options().map((option) => (
				<label {...stylex.attrs(styles.row)}>
					<input
						type="checkbox"
						checked={props.value.some(
							(grant) =>
								grant.pluginId === option.pluginId &&
								grant.toolId === option.toolId,
						)}
						onChange={(event) => {
							const next = props.value.filter(
								(grant) =>
									grant.pluginId !== option.pluginId ||
									grant.toolId !== option.toolId,
							);
							if (event.currentTarget.checked)
								next.push({ pluginId: option.pluginId, toolId: option.toolId });
							props.onChange(next);
						}}
					/>
					{option.label}
				</label>
			))}
		</fieldset>
	);
}
