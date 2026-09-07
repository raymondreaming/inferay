import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";
import type { CheckpointMeta } from "../../../../../build/presentation/contracts/CheckpointMeta.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import {
	IconChevronDown,
	IconClock,
} from "../../../../shared/ui/Icons/index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function CheckpointMarker(_props: {
	checkpoint: CheckpointMeta;
	onRevert: (id: string) => void;
}) {
	const [expanded, setExpanded] = createSignal(false);
	return (
		<div {...stylex.attrs(styles.checkpointCard)}>
			<div
				{...stylex.attrs(styles.checkpointHeader)}
				style={domStyle(
					inlineStyles.getCheckpointMarkerCheckpointHeaderStyle(
						expanded() ? "1px solid var(--color-inferay-gray-border)" : "none",
					),
				)}
			>
				<button
					type="button"
					onClick={() => setExpanded(!expanded())}
					{...stylex.attrs(styles.checkpointToggle)}
				>
					<IconChevronDown
						size={iconSize.compact}
						{...stylex.attrs(
							styles.checkpointChevron,
							!expanded() && styles.rotateClosed,
						)}
					/>
					<IconClock
						size={iconSize.compact}
						{...stylex.attrs(
							styles.checkpointIcon,
							_props.checkpoint.reverted && styles.revertedIcon,
						)}
					/>
					<span {...stylex.attrs(styles.checkpointTitle)}>
						{_props.checkpoint.changedFileCount} file
						{_props.checkpoint.changedFileCount !== 1 ? "s" : ""} changed
					</span>
				</button>
				<span {...stylex.attrs(styles.spacer)} />
				{!_props.checkpoint.reverted ? (
					<button
						type="button"
						onClick={() => _props.onRevert(_props.checkpoint.id)}
						{...stylex.attrs(styles.undoButton)}
					>
						Undo
					</button>
				) : (
					<span {...stylex.attrs(styles.revertedLabel)}>reverted</span>
				)}
			</div>
			{expanded() && (
				<div {...stylex.attrs(styles.checkpointFiles)}>
					{
						<For
							each={_props.checkpoint.changedFiles}
							keyed={(row) => row.path}
						>
							{(f) => (
								<div {...stylex.attrs(styles.checkpointFile)}>
									<span
										style={domStyle(
											inlineStyles.getCheckpointMarkerSpanStyle(
												f().action === "created"
													? "#22c55e"
													: f().action === "deleted"
														? "#ef4444"
														: "#eab308",
											),
										)}
									>
										{f().action === "created"
											? "+"
											: f().action === "deleted"
												? "-"
												: "~"}
									</span>
									<span {...stylex.attrs(styles.toolMuted)}>
										{f().path.split("/").pop()}
									</span>
								</div>
							)}
						</For>
					}
				</div>
			)}
		</div>
	);
}
