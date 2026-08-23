import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";

export type GitFileViewMode = "path" | "tree";

const GIT_FILE_VIEW_MODE_STORAGE_KEY = "inferay-git-file-view-mode";

export function loadGitFileViewMode(): GitFileViewMode {
	return readStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY) === "path"
		? "path"
		: "tree";
}

export function saveGitFileViewMode(mode: GitFileViewMode): void {
	writeStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY, mode);
}
