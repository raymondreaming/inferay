import type { GitFilePresentation } from "../../../../repository/model/types.ts";

export interface SelectedFile {
	path: string;
	staged: boolean;
}

export function visibleGitFiles<T extends { path: string }>(
	files: readonly T[],
	presentation: GitFilePresentation | undefined,
	mode: "path" | "tree",
): T[] {
	if (!presentation) return [...files];
	const current = new Map(files.map((file) => [file.path, file]));
	return (
		mode === "tree" ? presentation.treeOrder : presentation.pathOrder
	).flatMap((path) => {
		const file = current.get(path);
		return file ? [file] : [];
	});
}
