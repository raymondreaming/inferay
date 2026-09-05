export interface GitWorkspaceSelectedFile {
	readonly path: string;
	readonly staged: boolean;
}

export type GitWorkspaceDiffSource =
	| { readonly kind: "workingTree" | "graphWorkingTree" }
	| {
			readonly kind: "commit";
			readonly commitHash: string;
			readonly commitParent: string | null;
	  }
	| {
			readonly kind: "comparison";
			readonly comparisonFrom: string;
			readonly comparisonTo: string;
	  };

export interface GitWorkspaceDetachedFilePanel<InitialFile = unknown> {
	readonly id: string;
	readonly cwd: string;
	readonly path: string;
	readonly initialFile?: InitialFile;
}

export interface GitWorkspacePanelSession<InitialFile = unknown> {
	readonly repositoryInitialized: boolean;
	readonly sidebarVisible: boolean;
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
	readonly selectedFile:
		| (GitWorkspaceSelectedFile & { readonly source: GitWorkspaceDiffSource })
		| null;
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
		repositoryInitialized: false,
		sidebarVisible: false,
		fileViewerOpen: false,
		fileViewerCwd: null,
		diffViewerCwd: null,
		focusedAuxiliaryPanel: null,
		detachedFilePanels: [],
		fileRequest: null,
		selectedFile: null,
		selectedCommitHash: null,
		selectedCommitIds: [],
		selectedCommitParent: null,
		mainViewMode: "diff",
	};
}

function resolvedDiffContext(current: GitWorkspacePanelSession) {
	return current.mainViewMode === "diff"
		? current.selectedFile?.source.kind
		: undefined;
}

export function openGitGraph<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		mainViewMode: "graph",
		focusedAuxiliaryPanel: { id: "workspace-diff-viewer", cwd },
	};
}

/** Apply first-open defaults only after the directory is confirmed as a Git repository. */
export function initializeGitRepositoryPanels<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
): GitWorkspacePanelSession<InitialFile> {
	if (current.repositoryInitialized) return current;
	const next = current.diffViewerCwd ? current : openGitGraph(current, cwd);
	return {
		...next,
		repositoryInitialized: true,
		sidebarVisible: true,
		focusedAuxiliaryPanel: current.focusedAuxiliaryPanel,
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
		selectedCommitHash: repositoryChanged ? null : current.selectedCommitHash,
		selectedCommitIds: repositoryChanged ? [] : current.selectedCommitIds,
		selectedCommitParent: repositoryChanged
			? null
			: current.selectedCommitParent,
	};
}

function openFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	file: GitWorkspaceSelectedFile,
	source: GitWorkspaceDiffSource,
): GitWorkspacePanelSession<InitialFile> {
	return {
		...current,
		diffViewerCwd: cwd,
		selectedFile: { ...file, source },
		mainViewMode: "diff",
		focusedAuxiliaryPanel: { id: "workspace-diff-viewer", cwd },
	};
}

export function openGitWorkingTreeFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	file: GitWorkspaceSelectedFile,
): GitWorkspacePanelSession<InitialFile> {
	return openFileDiff(current, cwd, file, {
		kind:
			current.mainViewMode === "graph" ||
			resolvedDiffContext(current) === "graphWorkingTree"
				? "graphWorkingTree"
				: "workingTree",
	});
}

export function openGitCommitFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	path: string,
	commitHash: string,
	commitParent: string | null,
): GitWorkspacePanelSession<InitialFile> {
	return openFileDiff(
		current,
		cwd,
		{ path, staged: false },
		{ kind: "commit", commitHash, commitParent },
	);
}

export function openGitComparisonFileDiff<InitialFile>(
	current: GitWorkspacePanelSession<InitialFile>,
	cwd: string,
	path: string,
	from: string,
	to: string,
): GitWorkspacePanelSession<InitialFile> {
	return openFileDiff(
		current,
		cwd,
		{ path, staged: false },
		{ kind: "comparison", comparisonFrom: from, comparisonTo: to },
	);
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
	const context = resolvedDiffContext(current);
	return (
		current.mainViewMode === "diff" &&
		(context === "graphWorkingTree" ||
			context === "commit" ||
			context === "comparison")
	);
}

export function isHistoricalGitWorkspaceDiff(
	current: GitWorkspacePanelSession,
): boolean {
	const context = resolvedDiffContext(current);
	return (
		current.mainViewMode === "diff" &&
		(context === "commit" || context === "comparison")
	);
}

export function getGitWorkspaceSidebarContent(
	current: GitWorkspacePanelSession,
	selectedGraphItemIsWorkingTree: boolean,
): "workingTree" | "history" {
	if (current.mainViewMode === "graph") {
		return selectedGraphItemIsWorkingTree ? "workingTree" : "history";
	}
	const context = resolvedDiffContext(current);
	return context === "workingTree" || context === "graphWorkingTree"
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
	const nextPrimary = nextIds.includes(itemId)
		? itemId
		: (nextIds.at(-1) ?? null);
	const selectionChanged =
		nextPrimary !== current.selectedCommitHash ||
		nextIds.length !== current.selectedCommitIds.length ||
		nextIds.some((id, index) => id !== current.selectedCommitIds[index]);
	return {
		...current,
		selectedFile: selectionChanged ? null : current.selectedFile,
		selectedCommitHash: nextPrimary,
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
