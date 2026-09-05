import * as stylex from "@octanejs/stylex";
import { useState } from "octane";
import { writeStoredValue } from "../../../../adapters/storage/stored-values.ts";
import {
	dispatchAgentShellChange,
	loadAgentLayoutMode,
	loadAgentState,
	mutateAgentWorkspaceState,
} from "../../../workspace/model/workspace-model.ts";
import { styles } from "./styles.ts";

export function WorkspaceLayoutSection({
	contained = false,
}: {
	contained?: boolean;
}) {
	const [mode, setMode] = useState(loadAgentLayoutMode);
	const selected = loadAgentState()?.groups.find(
		(group) => group.id === loadAgentState()?.selectedGroupId,
	);
	const [columns, setColumns] = useState(selected?.columns ?? 1);
	const updateMode = (next: "grid" | "rows") => {
		setMode(next);
		writeStoredValue("agent-layout-mode", next);
		dispatchAgentShellChange({ source: "view", reason: "layout-mode" });
	};
	const updateColumns = async (next: number) => {
		setColumns(next);
		await mutateAgentWorkspaceState(
			(state) =>
				state.selectedGroupId
					? {
							type: "setGridDimensions",
							groupId: state.selectedGroupId,
							columns: next,
						}
					: null,
			"grid-size",
		);
	};
	return (
		<div
			id="workspace-layout"
			{...stylex.props(styles.section, contained && styles.sectionContained)}
		>
			<h4 {...stylex.props(styles.sectionHeading)}>Workspace layout</h4>
			<p {...stylex.props(styles.sectionDescription)}>
				Choose how chat panes are arranged in the selected workspace.
			</p>
			<div {...stylex.props(styles.layoutControls)}>
				<div {...stylex.props(styles.layoutControlGroup)}>
					<span {...stylex.props(styles.layoutControlLabel)}>Flow</span>
					<div {...stylex.props(styles.colorSourceOptions)}>
						{(["grid", "rows"] as const).map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => updateMode(value)}
								{...stylex.props(
									styles.colorSourceButton,
									mode === value && styles.colorSourceButtonSelected,
								)}
							>
								{value === "grid" ? "Grid" : "Rows"}
							</button>
						))}
					</div>
				</div>
				<div {...stylex.props(styles.layoutControlGroup)}>
					<span {...stylex.props(styles.layoutControlLabel)}>Columns</span>
					<div {...stylex.props(styles.colorSourceOptions)}>
						{[1, 2, 3, 4].map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => {
									updateMode("grid");
									void updateColumns(value);
								}}
								{...stylex.props(
									styles.colorSourceButton,
									mode === "grid" &&
										columns === value &&
										styles.colorSourceButtonSelected,
								)}
							>
								{value}
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
