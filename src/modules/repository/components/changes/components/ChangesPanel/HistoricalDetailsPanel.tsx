import type {
	GitCommitDetails,
	GitCommitFile,
	GitComparisonDetails,
	SelectedPanelFile,
} from "@contracts";
import { domStyle } from "@shared/lib/dom.tsx";
import { visibleGitFiles } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { DetailIdentity } from "./DetailIdentity.tsx";
import { FileGroup } from "./FileGroup.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

type SelectedFile = Pick<SelectedPanelFile, "path" | "staged">;
function HistoricalDetailsPanel(_props: {
	cwd?: string;
	details: GitCommitDetails | GitComparisonDetails;
	selectionCount?: number;
	selectedFile: SelectedFile | null;
	onSelectFile?: (file: GitCommitFile) => void;
	viewMode: "path" | "tree";
}) {
	const entries = createMemo(() =>
		visibleGitFiles(
			_props.details.files,
			_props.details.filePresentation,
			_props.viewMode,
		).map((file) => ({ ...file, staged: false })),
	);
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
									cwd={_props.cwd}
									hash={_details.hash}
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
					<FileGroup
						title="Changed"
						files={entries()}
						isCollapsible={false}
						showHeader={false}
						filePresentation={_props.details.filePresentation}
						selected={_props.selectedFile}
						viewMode={_props.viewMode}
						onSelect={(file) =>
							_props.onSelectFile?.({
								...file,
								additions: file.additions ?? 0,
								deletions: file.deletions ?? 0,
							})
						}
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

export function HistoryFiles(_props: {
	cwd?: string;
	historyLoading: boolean;
	historyDetails: GitCommitDetails | GitComparisonDetails | null;
	selectionCount: number | undefined;
	selectedFile: SelectedFile | null;
	onSelectFile: ((file: GitCommitFile) => void) | undefined;
	fileViewMode: "path" | "tree";
	historyMessage: string;
}) {
	return (
		<div {...stylex.attrs(styles.splitArea)}>
			{_props.historyDetails ? (
				<HistoricalDetailsPanel
					cwd={_props.cwd}
					details={_props.historyDetails}
					selectionCount={_props.selectionCount}
					selectedFile={_props.selectedFile}
					onSelectFile={_props.onSelectFile}
					viewMode={_props.fileViewMode}
				/>
			) : (
				<div {...stylex.attrs(styles.emptyStateLarge)}>
					<p
						{...stylex.attrs(
							styles.mutedText,
							!_props.historyLoading && styles.centerText,
						)}
					>
						{_props.historyMessage}
					</p>
				</div>
			)}
		</div>
	);
}
