import * as stylex from "@octanejs/stylex";
import { iconSize } from "../../../../../design-system/styles.stylex.ts";
import { LiquidSegmentedRail } from "../../../../../shared/ui/gooey/LiquidSegmentedRail/index.tsx";
import {
	IconGitBranch,
	IconLayoutGrid,
} from "../../../../../shared/ui/Icons/index.tsx";
import { DiffViewButton } from "./DiffViewButton.tsx";
import type { DiffViewMode } from "./shared.ts";
import { diffStyles } from "./styles.ts";

export function DiffViewToolbar({
	viewMode,
	onChange,
}: {
	viewMode: DiffViewMode;
	onChange: (viewMode: DiffViewMode) => void;
}) {
	return (
		<div {...stylex.props(diffStyles.toolbar)}>
			<div {...stylex.props(diffStyles.segmented)}>
				<LiquidSegmentedRail
					activeIndex={viewMode === "split" ? 0 : 1}
					itemCount={2}
					radius={8}
				/>
				<DiffViewButton
					active={viewMode === "split"}
					title="Full file diff"
					icon={<IconLayoutGrid size={iconSize.compact} />}
					onClick={() => onChange("split")}
				/>
				<DiffViewButton
					active={viewMode === "hunks"}
					title="Hunk view"
					icon={<IconGitBranch size={iconSize.compact} />}
					onClick={() => onChange("hunks")}
				/>
			</div>
		</div>
	);
}
