import { useMemo } from "octane";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
import {
	type SelectedFile,
	visibleGitFiles,
} from "../../../model/workbench-model.ts";
import { FileGroup } from "./FileGroup.tsx";

export function HistoricalFileList({
	files,
	filePresentation,
	selectedFile,
	viewMode,
	onSelectFile,
}: {
	files: GitCommitFile[];
	filePresentation?: GitFilePresentation;
	selectedFile: SelectedFile | null;
	viewMode: "path" | "tree";
	onSelectFile?: (file: GitCommitFile) => void;
}) {
	const orderedFiles = useMemo(
		() => visibleGitFiles(files, filePresentation, viewMode),
		[files, filePresentation, viewMode],
	);
	const entries = useMemo<GitFileEntry[]>(
		() => orderedFiles.map((file) => ({ ...file, staged: false })),
		[orderedFiles],
	);
	return (
		<FileGroup
			title="Changed"
			filePresentation={filePresentation}
			files={entries}
			selected={selectedFile}
			onSelect={(entry) => {
				const file = files.find(
					(candidate) =>
						candidate.path === entry.path &&
						candidate.originalPath === entry.originalPath,
				);
				if (file) onSelectFile?.(file);
			}}
			isCollapsible={false}
			showHeader={false}
			viewMode={viewMode}
		/>
	);
}
