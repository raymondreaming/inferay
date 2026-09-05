import * as stylex from "@octanejs/stylex";
import { useState } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	IconChevronDown,
	IconClock,
} from "../../../../shared/ui/Icons/index.tsx";
import type { CheckpointInfo } from "../../model/agent-chat-shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function CheckpointMarker({
	checkpoint,
	onRevert,
}: {
	checkpoint: CheckpointInfo;
	onRevert: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div {...stylex.props(styles.checkpointCard)}>
			<div
				{...stylex.props(styles.checkpointHeader)}
				style={inlineStyles.getCheckpointMarkerCheckpointHeaderStyle(
					expanded ? "1px solid var(--color-inferay-gray-border)" : "none",
				)}
			>
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					{...stylex.props(styles.checkpointToggle)}
				>
					<IconChevronDown
						size={iconSize.compact}
						{...stylex.props(
							styles.checkpointChevron,
							!expanded && styles.rotateClosed,
						)}
					/>
					<IconClock
						size={iconSize.compact}
						{...stylex.props(
							styles.checkpointIcon,
							checkpoint.reverted && styles.revertedIcon,
						)}
					/>
					<span {...stylex.props(styles.checkpointTitle)}>
						{checkpoint.changedFileCount} file
						{checkpoint.changedFileCount !== 1 ? "s" : ""} changed
					</span>
				</button>
				<span {...stylex.props(styles.spacer)} />
				{!checkpoint.reverted ? (
					<button
						type="button"
						onClick={() => onRevert(checkpoint.id)}
						{...stylex.props(styles.undoButton)}
					>
						Undo
					</button>
				) : (
					<span {...stylex.props(styles.revertedLabel)}>reverted</span>
				)}
			</div>
			{expanded && (
				<div {...stylex.props(styles.checkpointFiles)}>
					{checkpoint.changedFiles.map((f) => (
						<div key={f.path} {...stylex.props(styles.checkpointFile)}>
							<span
								style={inlineStyles.getCheckpointMarkerSpanStyle(
									f.action === "created"
										? "#22c55e"
										: f.action === "deleted"
											? "#ef4444"
											: "#eab308",
								)}
							>
								{f.action === "created"
									? "+"
									: f.action === "deleted"
										? "-"
										: "~"}
							</span>
							<span {...stylex.props(styles.toolMuted)}>
								{f.path.split("/").pop()}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
