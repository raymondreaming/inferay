import * as stylex from "@stylexjs/stylex";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
import { FileGroup } from "./FileGroup.tsx";
import type { SelectedFile } from "./index.tsx";
import { RepositoryStatus } from "./RepositoryStatus.tsx";
import { styles } from "./styles.ts";
export function WorkingTreeFiles(_props: {
	hasProject: boolean;
	projectLoading: boolean;
	filePresentation: GitFilePresentation | undefined;
	unstagedFiles: GitFileEntry[];
	stagedFiles: GitFileEntry[];
	selectedFile: SelectedFile | null;
	onPrefetchFile?: (file: GitFileEntry | null) => void;
	onSelectFile: (file: GitFileEntry) => void;
	showFileActions: boolean;
	onStageFile: (path: string) => void;
	onUnstageFile: (path: string) => void;
	onStageAll: () => void;
	onUnstageAll: () => void;
	fileViewMode: "path" | "tree";
}) {
	return (
		<div {...stylex.attrs(styles.splitArea)}>
			{!_props.hasProject ? (
				<RepositoryStatus projectLoading={_props.projectLoading} />
			) : (
				<>
					<FileGroup
						title="Unstaged"
						filePresentation={_props.filePresentation}
						files={_props.unstagedFiles}
						selected={_props.selectedFile}
						onSelect={_props.onSelectFile}
						onPrefetchFile={_props.onPrefetchFile}
						actionLabel={_props.showFileActions ? "Stage" : undefined}
						onAction={_props.showFileActions ? _props.onStageFile : undefined}
						onActionAll={_props.showFileActions ? _props.onStageAll : undefined}
						viewMode={_props.fileViewMode}
						splitPane
					/>
					<FileGroup
						title="Staged"
						filePresentation={_props.filePresentation}
						files={_props.stagedFiles}
						selected={_props.selectedFile}
						onSelect={_props.onSelectFile}
						onPrefetchFile={_props.onPrefetchFile}
						actionLabel={_props.showFileActions ? "Unstage" : undefined}
						onAction={_props.showFileActions ? _props.onUnstageFile : undefined}
						onActionAll={
							_props.showFileActions ? _props.onUnstageAll : undefined
						}
						viewMode={_props.fileViewMode}
						splitPane
					/>
				</>
			)}
		</div>
	);
}
