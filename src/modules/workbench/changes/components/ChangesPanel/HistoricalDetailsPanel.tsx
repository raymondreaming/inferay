import * as stylex from "@octanejs/stylex";
import type {
	CommitDetails,
	CommitFile,
	ComparisonDetails,
} from "../../../../repository/hooks/useGitGraph.tsx";
import type { SelectedFile } from "../../../model/workbench-model.ts";
import { DetailIdentity } from "./DetailIdentity.tsx";
import { HistoricalFileList } from "./HistoricalFileList.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function HistoricalDetailsPanel({
	details,
	selectionCount,
	selectedFile,
	onSelectFile,
	viewMode,
}: {
	details: CommitDetails | ComparisonDetails;
	selectionCount?: number;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: CommitFile) => void;
	viewMode: "path" | "tree";
}) {
	const comparison = "fromHash" in details;
	return (
		<div {...stylex.props(styles.detailsRoot)}>
			<div
				data-comparison-details-summary={comparison ? "true" : undefined}
				data-commit-details-summary={comparison ? undefined : "true"}
				{...stylex.props(styles.detailsHeader)}
			>
				{comparison ? (
					<>
						<span {...stylex.props(styles.detailIdentityLabel)}>
							Comparing {selectionCount} items
						</span>
						<div {...stylex.props(styles.comparisonRange)}>
							<code title={details.fromHash}>
								{details.fromHash.slice(0, 7)}
							</code>
							<span aria-hidden="true">→</span>
							<code title={details.toHash}>
								{details.toHash === "WORKTREE"
									? "WIP"
									: details.toHash.slice(0, 7)}
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
					</>
				) : (
					<>
						<p title={details.message} {...stylex.props(styles.commitMessage)}>
							{details.message}
						</p>
						{details.body ? (
							<div
								{...stylex.props(styles.commitDescriptionViewport)}
								style={inlineStyles.getCommitDetailsPanelCommitDescriptionViewportStyle()}
							>
								<p
									title={details.body}
									{...stylex.props(styles.commitDescription)}
								>
									{details.body}
								</p>
							</div>
						) : null}
						<div {...stylex.props(styles.detailIdentityGrid)}>
							<DetailIdentity
								name={details.author}
								email={details.authorEmail}
								date={details.authoredAt}
							/>
						</div>
					</>
				)}
			</div>
			<div {...stylex.props(styles.scrollArea)}>
				{!comparison || details.files.length ? (
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
