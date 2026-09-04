import {
	readStoredValue,
	writeStoredValue,
} from "../../../adapters/storage/stored-values.ts";

export type GitFileViewMode = "path" | "tree";

export const GIT_FILE_VIEW_MODE_STORAGE_KEY = "inferay-git-file-view-mode";
export const WORKBENCH_GRAPH_VISIBLE_STORAGE_KEY =
	"agent-workspace-graph-visible";
export const WORKBENCH_SIDEBAR_VISIBLE_STORAGE_KEY =
	"agent-workspace-changes-visible";

export function loadGitFileViewMode(): GitFileViewMode {
	return readStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY) === "path"
		? "path"
		: "tree";
}

export function saveGitFileViewMode(mode: GitFileViewMode): void {
	writeStoredValue(GIT_FILE_VIEW_MODE_STORAGE_KEY, mode);
}

export function loadWorkbenchGraphVisible(): boolean {
	return readStoredValue(WORKBENCH_GRAPH_VISIBLE_STORAGE_KEY) === "true";
}

export function saveWorkbenchGraphVisible(visible: boolean): void {
	writeStoredValue(WORKBENCH_GRAPH_VISIBLE_STORAGE_KEY, String(visible));
}

export function loadWorkbenchSidebarVisible(): boolean {
	return readStoredValue(WORKBENCH_SIDEBAR_VISIBLE_STORAGE_KEY) !== "false";
}

export function saveWorkbenchSidebarVisible(visible: boolean): void {
	writeStoredValue(WORKBENCH_SIDEBAR_VISIBLE_STORAGE_KEY, String(visible));
}
