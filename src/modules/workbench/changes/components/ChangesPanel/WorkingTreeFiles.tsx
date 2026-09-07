import * as stylex from "@octanejs/stylex";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
import { FileGroup } from "./FileGroup.tsx";
import type { SelectedFile } from "./index.tsx";
import { RepositoryStatus } from "./RepositoryStatus.tsx";
import { styles } from "./styles.ts";

export function WorkingTreeFiles({
	hasProject,
	projectLoading,
	filePresentation,
	unstagedFiles,
	stagedFiles,
	selectedFile,
	onSelectFile,
	showFileActions,
	onStageFile,
	onUnstageFile,
	onStageAll,
	onUnstageAll,
	fileViewMode,
}: {
	hasProject: boolean;
	projectLoading: boolean;
	filePresentation: GitFilePresentation | undefined;
	unstagedFiles: GitFileEntry[];
	stagedFiles: GitFileEntry[];
	selectedFile: SelectedFile | null;
	onSelectFile: (file: GitFileEntry) => void;
	showFileActions: boolean;
	onStageFile: (path: string) => void;
	onUnstageFile: (path: string) => void;
	onStageAll: () => void;
	onUnstageAll: () => void;
	fileViewMode: "path" | "tree";
}) {
	return (
		<div {...stylex.props(styles.splitArea)}>
			{!hasProject ? (
				<RepositoryStatus projectLoading={projectLoading} />
			) : (
				<>
					<FileGroup
						title="Unstaged"
						filePresentation={filePresentation}
						files={unstagedFiles}
						selected={selectedFile}
						onSelect={onSelectFile}
						actionLabel={showFileActions ? "Stage" : undefined}
						onAction={showFileActions ? onStageFile : undefined}
						onActionAll={showFileActions ? onStageAll : undefined}
						viewMode={fileViewMode}
						splitPane
					/>
					<FileGroup
						title="Staged"
						filePresentation={filePresentation}
						files={stagedFiles}
						selected={selectedFile}
						onSelect={onSelectFile}
						actionLabel={showFileActions ? "Unstage" : undefined}
						onAction={showFileActions ? onUnstageFile : undefined}
						onActionAll={showFileActions ? onUnstageAll : undefined}
						viewMode={fileViewMode}
						splitPane
					/>
				</>
			)}
		</div>
	);
}
