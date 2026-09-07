import * as stylex from "@stylexjs/stylex";
import type { GitCommitDetails } from "../../../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitComparisonDetails } from "../../../../../../build/presentation/contracts/GitComparisonDetails.ts";
import { HistoricalDetailsPanel } from "./HistoricalDetailsPanel.tsx";
import type { SelectedFile } from "./index.tsx";
import { styles } from "./styles.ts";
export function HistoryFiles(_props: {
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
			{!_props.historyLoading && _props.historyDetails ? (
				<HistoricalDetailsPanel
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
