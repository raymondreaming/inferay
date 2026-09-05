import * as stylex from "@octanejs/stylex";
import {
	iconSize,
	selectionAppearance,
} from "../../../../../design-system/styles.stylex.ts";
import {
	IconGitBranch,
	IconLayoutRows,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";

export function FileViewToggle({
	value,
	onChange,
}: {
	value: "path" | "tree";
	onChange: (mode: "path" | "tree") => void;
}) {
	return (
		<div {...stylex.props(styles.segmented)}>
			{(["path", "tree"] as const).map((mode) => {
				const ModeIcon = mode === "path" ? IconLayoutRows : IconGitBranch;
				return (
					<button
						type="button"
						key={mode}
						onClick={() => onChange(mode)}
						aria-pressed={value === mode}
						{...stylex.props(
							styles.segmentButton,
							...selectionAppearance("view", value === mode),
						)}
					>
						<ModeIcon size={iconSize.sm} />
						{mode === "path" ? "Path" : "Tree"}
					</button>
				);
			})}
		</div>
	);
}
