import { Dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import {
	iconSize,
	selectionAppearance,
} from "../../../../../design-system/styles.stylex.ts";
import { ariaValue } from "../../../../../shared/lib/dom.tsx";
import {
	IconGitBranch,
	IconLayoutRows,
} from "../../../../../shared/ui/Icons/index.tsx";
import { styles } from "./styles.ts";
export function FileViewToggle(_props: {
	value: "path" | "tree";
	onChange: (mode: "path" | "tree") => void;
}) {
	return (
		<div {...stylex.attrs(styles.segmented)}>
			{(["path", "tree"] as const).map((mode) => {
				const ModeIcon = createMemo(() =>
					mode === "path" ? IconLayoutRows : IconGitBranch,
				);
				return (
					<button
						type="button"
						onClick={() => _props.onChange(mode)}
						aria-pressed={ariaValue(_props.value === mode)}
						{...stylex.attrs(
							styles.segmentButton,
							...selectionAppearance("view", _props.value === mode),
						)}
					>
						<Dynamic component={ModeIcon()} size={iconSize.sm} />
						{mode === "path" ? "Path" : "Tree"}
					</button>
				);
			})}
		</div>
	);
}
