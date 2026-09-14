import type {
	GitCommitDetails,
	GitCommitFile,
	GitComparisonDetails,
	SelectedPanelFile,
} from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { HistoricalDetailsPanel } from "./HistoricalDetailsPanel.tsx";
import { styles } from "./styles.ts";

type SelectedFile = Pick<SelectedPanelFile, "path" | "staged">;
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
			{_props.historyDetails ? (
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
