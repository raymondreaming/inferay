import type { GitFileEntry, GitFileGroups, GraphCommit } from "@contracts";
import type { DiffViewMode } from "@repository/model/diff.ts";

export type SelectedGraphCache = {
	cwd: string | undefined;
	items: Map<string, GraphCommit>;
};

/** Retain selected commits while a graph refresh replaces its result set. */
export function resolveSelectedGraphItems(
	cache: SelectedGraphCache,
	cwd: string | undefined,
	commits: readonly GraphCommit[],
	selectedIds: readonly string[],
	selectedHash: string | null,
) {
	const current =
		cache.cwd === cwd
			? cache
			: {
					cwd,
					items: new Map<string, GraphCommit>(),
				};
	const selected = new Set(selectedIds);
	if (selectedHash) selected.add(selectedHash);
	for (const id of current.items.keys())
		if (!selected.has(id)) current.items.delete(id);
	for (const item of commits)
		if (selected.has(item.id)) current.items.set(item.id, item);
	return {
		cache: current,
		items: selectedIds.flatMap((id) => {
			const item = current.items.get(id);
			return item ? [item] : [];
		}),
		item: selectedHash ? (current.items.get(selectedHash) ?? null) : null,
	};
}

export function workingTreeKeyboardFiles(
	groups: GitFileGroups,
	visible: (files: readonly GitFileEntry[]) => GitFileEntry[],
): GitFileEntry[] {
	return [
		...visible([...groups.modified, ...groups.untracked]),
		...visible(groups.staged),
	];
}

export const GIT_FILE_VIEW_MODE_STORAGE_KEY = "inferay-git-file-view-mode";
export const SIDEBAR_WIDTH_KEY = "agent-workspace-changes-width";
export const DIFF_WIDTH_KEY = "agent-workspace-diff-width";
export const DIFF_WIDTH_KEY_PREFIX = "agent-workspace-diff-width:";
export const DIFF_VIEW_MODE_KEY = "agent-workspace-diff-view-mode";
export const MIN_SIDEBAR_WIDTH = 230;
export const MAX_SIDEBAR_WIDTH = 420;
export const MIN_DIFF_WIDTH = 320;

const DEFAULT_SIDEBAR_WIDTH = 300;
const DEFAULT_DIFF_WIDTH = 680;

type StoredValueReader = (key: string) => string | null;

export function loadGitFileViewMode(read: StoredValueReader): "path" | "tree" {
	return read(GIT_FILE_VIEW_MODE_STORAGE_KEY) === "path" ? "path" : "tree";
}

export function loadSidebarWidth(read: StoredValueReader): number {
	const stored = Number(read(SIDEBAR_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0
		? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
		: DEFAULT_SIDEBAR_WIDTH;
}

export function loadDiffWidth(
	read: StoredValueReader,
	workspaceId: string,
): number {
	const stored = Number(
		read(DIFF_WIDTH_KEY) ?? read(`${DIFF_WIDTH_KEY_PREFIX}${workspaceId}`),
	);
	return Number.isFinite(stored) && stored > 0
		? Math.max(MIN_DIFF_WIDTH, stored)
		: DEFAULT_DIFF_WIDTH;
}

export function loadDiffViewMode(read: StoredValueReader): DiffViewMode {
	return read(DIFF_VIEW_MODE_KEY) === "split" ? "split" : "hunks";
}
