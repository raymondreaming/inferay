import type { AgentToolGrant } from "@contracts";
import { project } from "@shared/lib/native.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { projects } from "../../hooks/useProjects.tsx";
import { styles } from "./styles.ts";

export function AutomationTools(props: {
	value: AgentToolGrant[];
	onChange: (value: AgentToolGrant[]) => void;
}) {
	return (
		<fieldset {...stylex.attrs(styles.form)}>
			<legend>Library tools</legend>
			<p {...stylex.attrs(styles.muted)}>
				Available tools can be called by the agent. “Must pass” checks are
				required for a successful run.
			</p>
			<For
				each={projects.catalog()?.toolChoices ?? []}
				keyed={(option) => `${option.pluginId}/${option.toolId}`}
			>
				{(option) => {
					const grant = () =>
						props.value.find(
							(item) =>
								item.pluginId === option().pluginId &&
								item.toolId === option().toolId,
						);
					return (
						<div {...stylex.attrs(styles.row)}>
							<span>{option().label}</span>
							<DropdownButton
								aria-label={`${option().label} access`}
								value={
									grant()
										? grant()?.required
											? "required"
											: "optional"
										: "none"
								}
								options={[
									{ id: "none", label: "Not available" },
									{ id: "optional", label: "Available" },
									{ id: "required", label: "Must pass" },
								]}
								onChange={(value) => {
									props.onChange(
										project("editToolGrant", {
											grants: props.value,
											grant: {
												pluginId: option().pluginId,
												toolId: option().toolId,
												required: value === "required",
											},
											enabled: value !== "none",
										}),
									);
								}}
							/>
						</div>
					);
				}}
			</For>
		</fieldset>
	);
}
