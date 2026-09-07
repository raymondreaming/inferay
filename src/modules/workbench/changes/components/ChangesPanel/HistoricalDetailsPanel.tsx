import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { GitCommitDetails } from "../../../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitComparisonDetails } from "../../../../../../build/presentation/contracts/GitComparisonDetails.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import { DetailIdentity } from "./DetailIdentity.tsx";
import { HistoricalFileList } from "./HistoricalFileList.tsx";
import type { SelectedFile } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function HistoricalDetailsPanel(_props: {
	details: GitCommitDetails | GitComparisonDetails;
	selectionCount?: number;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: GitCommitFile) => void;
	viewMode: "path" | "tree";
}) {
	const comparison = createMemo(() => "fromHash" in _props.details);
	return (
		<div {...stylex.attrs(styles.detailsRoot)}>
			<div
				data-comparison-details-summary={comparison() ? "true" : undefined}
				data-commit-details-summary={comparison() ? undefined : "true"}
				{...stylex.attrs(styles.detailsHeader)}
			>
				{(() => {
					const _details = _props.details;
					return "fromHash" in _details ? (
						<>
							<span {...stylex.attrs(styles.detailIdentityLabel)}>
								Comparing {_props.selectionCount} items
							</span>
							<div {...stylex.attrs(styles.comparisonRange)}>
								<code title={_details.fromHash}>
									{_details.fromHash.slice(0, 7)}
								</code>
								<span aria-hidden="true">→</span>
								<code title={_details.toHash}>
									{_details.toHash === "WORKTREE"
										? "WIP"
										: _details.toHash.slice(0, 7)}
								</code>
							</div>
							{_details.mergeBase ? (
								<span
									{...stylex.attrs(styles.mutedTextSmall)}
									title={_details.mergeBase}
								>
									Merge base {_details.mergeBase.slice(0, 7)}
								</span>
							) : null}
						</>
					) : (
						<>
							<p
								title={_details.message}
								{...stylex.attrs(styles.commitMessage)}
							>
								{_details.message}
							</p>
							{_details.body ? (
								<div
									{...stylex.attrs(styles.commitDescriptionViewport)}
									style={domStyle(
										inlineStyles.getCommitDetailsPanelCommitDescriptionViewportStyle(),
									)}
								>
									<p
										title={_details.body}
										{...stylex.attrs(styles.commitDescription)}
									>
										{_details.body}
									</p>
								</div>
							) : null}
							<div {...stylex.attrs(styles.detailIdentityGrid)}>
								<DetailIdentity
									name={_details.author}
									email={_details.authorEmail}
									date={_details.authoredAt}
								/>
							</div>
						</>
					);
				})()}
			</div>
			<div {...stylex.attrs(styles.scrollArea)}>
				{!comparison() || _props.details.files.length ? (
					<HistoricalFileList
						files={_props.details.files}
						filePresentation={_props.details.filePresentation}
						selectedFile={_props.selectedFile}
						viewMode={_props.viewMode}
						onSelectFile={_props.onSelectFile}
					/>
				) : (
					<div {...stylex.attrs(styles.emptyStateLarge)}>
						<p {...stylex.attrs(styles.mutedText)}>No file differences</p>
					</div>
				)}
			</div>
		</div>
	);
}
