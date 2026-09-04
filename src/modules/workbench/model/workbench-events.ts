export const OPEN_ACTIVE_GIT_GRAPH_EVENT = "inferay-open-active-git-graph";
export const TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT =
	"inferay-toggle-active-git-sidebar";

export function dispatchOpenActiveGitGraph(): void {
	window.dispatchEvent(new CustomEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT));
}

export function dispatchToggleActiveGitSidebar(): void {
	window.dispatchEvent(new CustomEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT));
}
