import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import {
	loadAgentLayoutMode,
	setAgentLayoutMode,
} from "../../../../shared/lib/native.tsx";
import {
	mutateAgentWorkspaceState,
	useWorkspaceState,
} from "../../../workspace/hooks/useWorkspaceState.tsx";
import { styles } from "./styles.ts";
export function WorkspaceLayoutSection(_props: { contained?: boolean }) {
	const [mode, setMode] = createSignal(loadAgentLayoutMode);
	const [workspace] = useWorkspaceState(() => false);
	const selected = createMemo(() =>
		workspace().groups.find(
			(group) => group.id === workspace().selectedGroupId,
		),
	);
	const [columns, setColumns] = createSignal(() => selected()?.columns ?? 1);
	const updateMode = (next: "grid" | "rows") => {
		setMode(next);
		setAgentLayoutMode(next);
	};
	const updateColumns = async (next: number) => {
		setColumns(next);
		await mutateAgentWorkspaceState((state) =>
			state.selectedGroupId
				? {
						type: "setGridDimensions",
						groupId: state.selectedGroupId,
						columns: next,
					}
				: null,
		);
	};
	return (
		<div
			id="workspace-layout"
			{...stylex.attrs(
				styles.section,
				(_props.contained === undefined ? false : _props.contained) &&
					styles.sectionContained,
			)}
		>
			<h4 {...stylex.attrs(styles.sectionHeading)}>Workspace layout</h4>
			<p {...stylex.attrs(styles.sectionDescription)}>
				Choose how chat panes are arranged in the selected workspace.
			</p>
			<div {...stylex.attrs(styles.layoutControls)}>
				<div {...stylex.attrs(styles.layoutControlGroup)}>
					<span {...stylex.attrs(styles.layoutControlLabel)}>Flow</span>
					<div {...stylex.attrs(styles.colorSourceOptions)}>
						{(["grid", "rows"] as const).map((value) => (
							<button
								type="button"
								onClick={() => updateMode(value)}
								{...stylex.attrs(
									styles.colorSourceButton,
									mode() === value && styles.colorSourceButtonSelected,
								)}
							>
								{value === "grid" ? "Grid" : "Rows"}
							</button>
						))}
					</div>
				</div>
				<div {...stylex.attrs(styles.layoutControlGroup)}>
					<span {...stylex.attrs(styles.layoutControlLabel)}>Columns</span>
					<div {...stylex.attrs(styles.colorSourceOptions)}>
						{[1, 2, 3, 4].map((value) => (
							<button
								type="button"
								onClick={() => {
									updateMode("grid");
									void updateColumns(value);
								}}
								{...stylex.attrs(
									styles.colorSourceButton,
									mode() === "grid" &&
										columns() === value &&
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
