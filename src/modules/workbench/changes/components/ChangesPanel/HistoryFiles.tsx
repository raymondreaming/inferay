import * as stylex from "@octanejs/stylex";
import type { GitCommitDetails } from "../../../../../../build/presentation/contracts/GitCommitDetails.ts";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitComparisonDetails } from "../../../../../../build/presentation/contracts/GitComparisonDetails.ts";
import { HistoricalDetailsPanel } from "./HistoricalDetailsPanel.tsx";
import type { SelectedFile } from "./index.tsx";
import { styles } from "./styles.ts";

export function HistoryFiles({
	historyLoading,
	historyDetails,
	selectionCount,
	selectedFile,
	onSelectFile,
	fileViewMode,
	historyMessage,
}: {
	historyLoading: boolean;
	historyDetails: GitCommitDetails | GitComparisonDetails | null;
	selectionCount: number | undefined;
	selectedFile: SelectedFile | null;
	onSelectFile: ((file: GitCommitFile) => void) | undefined;
	fileViewMode: "path" | "tree";
	historyMessage: string;
}) {
	return (
		<div {...stylex.props(styles.splitArea)}>
			{!historyLoading && historyDetails ? (
				<HistoricalDetailsPanel
					details={historyDetails}
					selectionCount={selectionCount}
					selectedFile={selectedFile}
					onSelectFile={onSelectFile}
					viewMode={fileViewMode}
				/>
			) : (
				<div {...stylex.props(styles.emptyStateLarge)}>
					<p
						{...stylex.props(
							styles.mutedText,
							!historyLoading && styles.centerText,
						)}
					>
						{historyMessage}
					</p>
				</div>
			)}
		</div>
	);
}
