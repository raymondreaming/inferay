import type { DiffViewMode } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { IconGitBranch, IconLayoutGrid } from "@shared/ui/Icons/index.tsx";
import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";

import { diffStyles } from "./styles.ts";
export function DiffViewToolbar(_props: {
	viewMode: DiffViewMode;
	onChange: (viewMode: DiffViewMode) => void;
}) {
	return (
		<div {...stylex.attrs(diffStyles.toolbar)}>
			<div {...stylex.attrs(diffStyles.segmented)}>
				{(["split", "hunks"] as const).map((mode) => (
					<button
						type="button"
						title={mode === "split" ? "Full file diff" : "Hunk view"}
						onClick={() => _props.onChange(mode)}
						{...stylex.attrs(
							diffStyles.viewButton,
							_props.viewMode === mode && diffStyles.viewButtonActive,
						)}
					>
						<Dynamic
							component={mode === "split" ? IconLayoutGrid : IconGitBranch}
							size={iconSize.compact}
						/>
					</button>
				))}
			</div>
		</div>
	);
}
