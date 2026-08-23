export const WORKSPACE_FILE_OPEN_EVENT = "workspace-file-open";

export type WorkspaceFileOpenDetail = {
	readonly cwd: string;
	readonly path: string;
};

export function dispatchWorkspaceFileOpen(detail: WorkspaceFileOpenDetail) {
	window.dispatchEvent(
		new CustomEvent<WorkspaceFileOpenDetail>(WORKSPACE_FILE_OPEN_EVENT, {
			detail,
		}),
	);
}
