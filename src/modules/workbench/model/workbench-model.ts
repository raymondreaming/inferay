export interface GitWorkspaceSelectedFile {
	readonly path: string;
	readonly staged: boolean;
}

export type GitWorkspaceDiffContext =
	| "workingTree"
	| "graphWorkingTree"
	| "commit"
	| "comparison";

export interface GitWorkspaceDetachedFilePanel<InitialFile = unknown> {
	readonly id: string;
	readonly cwd: string;
	readonly path: string;
	readonly initialFile?: InitialFile;
}

export interface GitWorkspacePanelSession<InitialFile = unknown> {
	readonly fileViewerOpen: boolean;
	readonly fileViewerCwd: string | null;
	readonly diffViewerCwd: string | null;
	readonly focusedAuxiliaryPanel: {
		readonly id: string;
		readonly cwd: string;
	} | null;
	readonly detachedFilePanels: GitWorkspaceDetachedFilePanel<InitialFile>[];
	readonly fileRequest: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly selectedFile: GitWorkspaceSelectedFile | null;
	readonly selectedFileCommitHash: string | null;
	readonly selectedFileCommitParent: string | null;
	readonly selectedFileComparisonFrom: string | null;
	readonly selectedFileComparisonTo: string | null;
	readonly diffContext: GitWorkspaceDiffContext | null;
	readonly selectedCommitHash: string | null;
	readonly selectedCommitIds: readonly string[];
	readonly selectedCommitParent: string | null;
	readonly mainViewMode: "diff" | "graph";
}

export interface GitGraphSelectionIntent {
	readonly additive: boolean;
	readonly range: boolean;
}

export interface GitGraphSelectionItem {
	readonly id: string;
	readonly message: string;
}

export function emptyGitWorkspacePanelSession<
	InitialFile = unknown,
>(): GitWorkspacePanelSession<InitialFile> {
	return {
		fileViewerOpen: false,
		fileViewerCwd: null,
		diffViewerCwd: null,
		focusedAuxiliaryPanel: null,
		detachedFilePanels: [],
		fileRequest: null,
		selectedFile: null,
		selectedFileCommitHash: null,
		selectedFileCommitParent: null,
		selectedFileComparisonFrom: null,
		selectedFileComparisonTo: null,
		diffContext: null,
		selectedCommitHash: null,
		selectedCommitIds: [],
		selectedCommitParent: null,
		mainViewMode: "diff",
	};
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function normalizedDiffContext(value: unknown): GitWorkspaceDiffContext | null {
	return value === "workingTree" ||
		value === "graphWorkingTree" ||
		value === "commit" ||
		value === "comparison"
		? value
		: null;
}

export function normalizeGitWorkspacePanelSession<InitialFile = unknown>(
	value: unknown,
	now = Date.now(),
): GitWorkspacePanelSession<InitialFile> {
	if (!value || typeof value !== "object") {
		return emptyGitWorkspacePanelSession<InitialFile>();
	}
	const stored = value as Partial<GitWorkspacePanelSession<InitialFile>>;
	const detachedFilePanels = Array.isArray(stored.detachedFilePanels)
		? stored.detachedFilePanels.filter(
				(panel): panel is GitWorkspaceDetachedFilePanel<InitialFile> =>
					typeof panel?.id === "string" &&
					typeof panel.cwd === "string" &&
					typeof panel.path === "string",
			)
		: [];
	const selectedCommitHash = nullableString(stored.selectedCommitHash);
	return {
		...emptyGitWorkspacePanelSession<InitialFile>(),
		fileViewerOpen: stored.fileViewerOpen === true,
		fileViewerCwd: nullableString(stored.fileViewerCwd),
		diffViewerCwd: nullableString(stored.diffViewerCwd),
		focusedAuxiliaryPanel:
			stored.focusedAuxiliaryPanel &&
			typeof stored.focusedAuxiliaryPanel.id === "string" &&
			typeof stored.focusedAuxiliaryPanel.cwd === "string"
				? stored.focusedAuxiliaryPanel
				: null,
		detachedFilePanels,
		fileRequest:
			stored.fileRequest && typeof stored.fileRequest.path === "string"
				? { path: stored.fileRequest.path, token: now }
				: null,
		selectedFile:
			stored.selectedFile &&
			typeof stored.selectedFile.path === "string" &&
			typeof stored.selectedFile.staged === "boolean"
				? stored.selectedFile
				: null,
		selectedFileCommitHash: nullableString(stored.selectedFileCommitHash),
		selectedFileCommitParent: nullableString(stored.selectedFileCommitParent),
		selectedFileComparisonFrom: nullableString(
			stored.selectedFileComparisonFrom,
		),
		selectedFileComparisonTo: nullableString(stored.selectedFileComparisonTo),
		diffContext: normalizedDiffContext(stored.diffContext),
		selectedCommitHash,
		selectedCommitIds: Array.isArray(stored.selectedCommitIds)
			? stored.selectedCommitIds.filter(
					(value): value is string => typeof value === "string",
				)
			: selectedCommitHash
				? [selectedCommitHash]
				: [],
		selectedCommitParent: nullableString(stored.selectedCommitParent),
		mainViewMode: stored.mainViewMode === "graph" ? "graph" : "diff",
	};
}

export function serializeGitWorkspacePanelSession<InitialFile>(
	session: GitWorkspacePanelSession<InitialFile>,
): GitWorkspacePanelSession<never> {
	return {
		...session,
		detachedFilePanels: session.detachedFilePanels.map((panel) => ({
			id: panel.id,
			cwd: panel.cwd,
			path: panel.path,
		})),
	};
}

export function openGitGraph<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		diffContext: null,
		mainViewMode: "graph",
		focusedAuxiliaryPanel: { id: "workspace-diff-viewer", cwd },
	};
}

/** Bind an open graph to the repository owned by the newly focused chat. */
export function bindGitGraphRepository<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	const repositoryChanged = current.diffViewerCwd !== cwd;
	return {
		...current,
		diffViewerCwd: cwd,
		focusedAuxiliaryPanel: null,
		selectedFile: repositoryChanged ? null : current.selectedFile,
		selectedFileCommitHash: repositoryChanged
			? null
			: current.selectedFileCommitHash,
		selectedFileCommitParent: repositoryChanged
			? null
			: current.selectedFileCommitParent,
		selectedFileComparisonFrom: repositoryChanged
			? null
			: current.selectedFileComparisonFrom,
		selectedFileComparisonTo: repositoryChanged
			? null
			: current.selectedFileComparisonTo,
		diffContext: null,
		selectedCommitHash: repositoryChanged ? null : current.selectedCommitHash,
		selectedCommitIds: repositoryChanged ? [] : current.selectedCommitIds,
		selectedCommitParent: repositoryChanged
			? null
			: current.selectedCommitParent,
	};
}

export function openGitWorkingTreeFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	file: GitWorkspaceSelectedFile,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		selectedFile: file,
		selectedFileCommitHash: null,
		selectedFileCommitParent: null,
		selectedFileComparisonFrom: null,
		selectedFileComparisonTo: null,
		diffContext:
			current.mainViewMode === "graph" ||
			current.diffContext === "graphWorkingTree"
				? "graphWorkingTree"
				: "workingTree",
		mainViewMode: "diff",
		focusedAuxiliaryPanel: { id: "workspace-diff-viewer", cwd },
	};
}

export function openGitCommitFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	path: string,
	commitHash: string,
	commitParent: string | null,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		selectedFile: { path, staged: false },
		selectedFileCommitHash: commitHash,
		selectedFileCommitParent: commitParent,
		selectedFileComparisonFrom: null,
		selectedFileComparisonTo: null,
		diffContext: "commit",
		mainViewMode: "diff",
		focusedAuxiliaryPanel: { id: "workspace-diff-viewer", cwd },
	};
}

export function openGitComparisonFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	path: string,
	from: string,
	to: string,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		selectedFile: { path, staged: false },
		selectedFileCommitHash: null,
		selectedFileCommitParent: null,
		selectedFileComparisonFrom: from,
		selectedFileComparisonTo: to,
		diffContext: "comparison",
		mainViewMode: "diff",
		focusedAuxiliaryPanel: { id: "workspace-diff-viewer", cwd },
	};
}

export function dismissGitWorkspaceViewer<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
): GitWorkspacePanelSession<InitialFile> {
	const graphCwd = current.diffViewerCwd;
	const returnsToGraph =
		graphCwd !== null && isGitWorkspaceGraphDrillIn(current);
	if (returnsToGraph) {
		return openGitGraph(current, graphCwd);
	}
	return {
		...current,
		selectedFile: null,
		selectedFileCommitHash: null,
		selectedFileCommitParent: null,
		selectedFileComparisonFrom: null,
		selectedFileComparisonTo: null,
		diffContext: null,
		selectedCommitHash: null,
		selectedCommitIds: [],
		selectedCommitParent: null,
		mainViewMode: "diff",
		diffViewerCwd: null,
		focusedAuxiliaryPanel:
			current.focusedAuxiliaryPanel?.id === "workspace-diff-viewer"
				? null
				: current.focusedAuxiliaryPanel,
	};
}

export function isGitWorkspaceGraphDrillIn(
	current: GitWorkspacePanelSession,
): boolean {
	return (
		current.mainViewMode === "diff" &&
		(current.diffContext === "graphWorkingTree" ||
			current.diffContext === "commit" ||
			current.diffContext === "comparison")
	);
}

export function isHistoricalGitWorkspaceDiff(
	current: GitWorkspacePanelSession,
): boolean {
	return (
		current.mainViewMode === "diff" &&
		(current.diffContext === "commit" || current.diffContext === "comparison")
	);
}

export function getGitWorkspaceSidebarContent(
	current: GitWorkspacePanelSession,
	selectedGraphItemIsWorkingTree: boolean,
): "workingTree" | "history" {
	if (current.mainViewMode === "graph") {
		return selectedGraphItemIsWorkingTree ? "workingTree" : "history";
	}
	return current.diffContext === "workingTree" ||
		current.diffContext === "graphWorkingTree"
		? "workingTree"
		: "history";
}

export function updateGitGraphSelection<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	itemId: string | null,
	orderedItemIds: readonly string[],
	intent?: GitGraphSelectionIntent,
): GitWorkspacePanelSession<InitialFile> {
	if (!itemId) {
		return {
			...current,
			selectedCommitHash: null,
			selectedCommitIds: [],
			selectedCommitParent: null,
		};
	}
	let nextIds: readonly string[] = [itemId];
	if (intent?.range && current.selectedCommitHash) {
		const anchor = orderedItemIds.indexOf(current.selectedCommitHash);
		const target = orderedItemIds.indexOf(itemId);
		if (anchor >= 0 && target >= 0) {
			nextIds = orderedItemIds.slice(
				Math.min(anchor, target),
				Math.max(anchor, target) + 1,
			);
		}
	} else if (intent?.additive) {
		nextIds = current.selectedCommitIds.includes(itemId)
			? current.selectedCommitIds.filter((id) => id !== itemId)
			: [...current.selectedCommitIds, itemId];
	}
	return {
		...current,
		selectedCommitHash: nextIds.includes(itemId)
			? itemId
			: (nextIds.at(-1) ?? null),
		selectedCommitIds: nextIds,
		selectedCommitParent: null,
	};
}

export function reconcileGitGraphSelection<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	items: readonly GitGraphSelectionItem[],
): {
	readonly session: GitWorkspacePanelSession<InitialFile>;
	readonly announcement: string | null;
} {
	if (items.length === 0) return { session: current, announcement: null };
	const first = items[0]!;
	const visibleIds = new Set(items.map((item) => item.id));
	const retainedIds = current.selectedCommitIds.filter((id) =>
		visibleIds.has(id),
	);
	const nextIds = retainedIds.length ? retainedIds : [first.id];
	const nextPrimary =
		current.selectedCommitHash && visibleIds.has(current.selectedCommitHash)
			? current.selectedCommitHash
			: (nextIds.at(-1) ?? null);
	if (
		nextPrimary === current.selectedCommitHash &&
		nextIds.length === current.selectedCommitIds.length &&
		nextIds.every((id, index) => id === current.selectedCommitIds[index])
	) {
		return { session: current, announcement: null };
	}
	return {
		session: {
			...current,
			selectedCommitHash: nextPrimary,
			selectedCommitIds: nextIds,
			selectedCommitParent: null,
		},
		announcement: current.selectedCommitHash
			? `The selected graph item is no longer available. Selected ${first.message}.`
			: null,
	};
}
