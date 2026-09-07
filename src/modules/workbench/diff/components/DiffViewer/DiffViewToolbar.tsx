import * as stylex from "@stylexjs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { LiquidSegmentedRail } from "../../../../../shared/ui/gooey/LiquidSegmentedRail/index.tsx";
import {
	IconGitBranch,
	IconLayoutGrid,
} from "../../../../../shared/ui/Icons/index.tsx";
import { DiffViewButton } from "./DiffViewButton.tsx";
import type { DiffViewMode } from "./index.tsx";
import { diffStyles } from "./styles.ts";
export function DiffViewToolbar(_props: {
	viewMode: DiffViewMode;
	onChange: (viewMode: DiffViewMode) => void;
}) {
	return (
		<div {...stylex.attrs(diffStyles.toolbar)}>
			<div {...stylex.attrs(diffStyles.segmented)}>
				<LiquidSegmentedRail
					activeIndex={_props.viewMode === "split" ? 0 : 1}
					itemCount={2}
					radius={8}
				/>
				<DiffViewButton
					active={_props.viewMode === "split"}
					title="Full file diff"
					icon={<IconLayoutGrid size={iconSize.compact} />}
					onClick={() => _props.onChange("split")}
				/>
				<DiffViewButton
					active={_props.viewMode === "hunks"}
					title="Hunk view"
					icon={<IconGitBranch size={iconSize.compact} />}
					onClick={() => _props.onChange("hunks")}
				/>
			</div>
		</div>
	);
}
