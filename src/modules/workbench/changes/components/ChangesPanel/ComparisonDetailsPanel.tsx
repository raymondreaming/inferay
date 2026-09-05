import * as stylex from "@octanejs/stylex";
import type {
	CommitFile,
	ComparisonDetails,
} from "../../../../repository/hooks/useGitGraph.tsx";
import { HistoricalFileList } from "./HistoricalFileList.tsx";
import type { SelectedFile } from "./shared.ts";
import { styles } from "./styles.ts";

export function ComparisonDetailsPanel({
	details,
	selectionCount,
	selectedFile,
	onSelectFile,
	viewMode,
}: {
	details: ComparisonDetails;
	selectionCount: number;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: CommitFile) => void;
	viewMode: "path" | "tree";
}) {
	return (
		<div {...stylex.props(styles.detailsRoot)}>
			<div
				data-comparison-details-summary="true"
				{...stylex.props(styles.detailsHeader)}
			>
				<span {...stylex.props(styles.detailIdentityLabel)}>
					Comparing {selectionCount} items
				</span>
				<div {...stylex.props(styles.comparisonRange)}>
					<code title={details.fromHash}>{details.fromHash.slice(0, 7)}</code>
					<span aria-hidden="true">→</span>
					<code title={details.toHash}>
						{details.toHash === "WORKTREE" ? "WIP" : details.toHash.slice(0, 7)}
					</code>
				</div>
				{details.mergeBase ? (
					<span
						{...stylex.props(styles.mutedTextSmall)}
						title={details.mergeBase}
					>
						Merge base {details.mergeBase.slice(0, 7)}
					</span>
				) : null}
			</div>
			<div {...stylex.props(styles.scrollArea)}>
				{details.files.length ? (
					<HistoricalFileList
						files={details.files}
						filePresentation={details.filePresentation}
						selectedFile={selectedFile}
						viewMode={viewMode}
						onSelectFile={onSelectFile}
					/>
				) : (
					<div {...stylex.props(styles.emptyStateLarge)}>
						<p {...stylex.props(styles.mutedText)}>No file differences</p>
					</div>
				)}
			</div>
		</div>
	);
}
