import type { AgentToolGrant } from "@contracts";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
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
				Available tools can be called by the agent. “Must pass” checks are
				required for a successful run.
			</p>
			{options().map((option) => {
				const grant = () =>
					props.value.find(
						(item) =>
							item.pluginId === option.pluginId &&
							item.toolId === option.toolId,
					);
				return (
					<div {...stylex.attrs(styles.row)}>
						<span>{option.label}</span>
						<DropdownButton
							aria-label={`${option.label} access`}
							value={
								grant() ? (grant()?.required ? "required" : "optional") : "none"
							}
							options={[
								{ id: "none", label: "Not available" },
								{ id: "optional", label: "Available" },
								{ id: "required", label: "Must pass" },
							]}
							onChange={(value) => {
								const next = props.value.filter(
									(item) =>
										item.pluginId !== option.pluginId ||
										item.toolId !== option.toolId,
								);
								if (value !== "none")
									next.push({
										pluginId: option.pluginId,
										toolId: option.toolId,
										required: value === "required",
									});
								props.onChange(next);
							}}
						/>
					</div>
				);
			})}
		</fieldset>
	);
}
