import { createMemo } from "solid-js";
import type { GitCommitFile } from "../../../../../../build/presentation/contracts/GitCommitFile.ts";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import type { GitFilePresentation } from "../../../../../../build/presentation/contracts/GitFilePresentation.ts";
import { visibleGitFiles } from "../../../../../shared/lib/native.tsx";
import { FileGroup } from "./FileGroup.tsx";
import type { SelectedFile } from "./index.tsx";
export function HistoricalFileList(_props: {
	files: GitCommitFile[];
	filePresentation?: GitFilePresentation;
	selectedFile: SelectedFile | null;
	viewMode: "path" | "tree";
	onSelectFile?: (file: GitCommitFile) => void;
}) {
	const orderedFiles = createMemo(() =>
		visibleGitFiles(_props.files, _props.filePresentation, _props.viewMode),
	);
	const entries = createMemo<GitFileEntry[]>(() =>
		orderedFiles().map((file) => ({
			...file,
			staged: false,
		})),
	);
	return (
		<FileGroup
			title="Changed"
			filePresentation={_props.filePresentation}
			files={entries()}
			selected={_props.selectedFile}
			onSelect={(entry) => {
				const file = _props.files.find(
					(candidate) =>
						candidate.path === entry.path &&
						candidate.originalPath === entry.originalPath,
				);
				if (file) _props.onSelectFile?.(file);
			}}
			isCollapsible={false}
			showHeader={false}
			viewMode={_props.viewMode}
		/>
	);
}
