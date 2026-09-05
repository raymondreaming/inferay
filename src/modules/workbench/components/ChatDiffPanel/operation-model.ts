import type { GitInteractiveRebaseStep } from "../../../repository/model/types.ts";

import type { GitGraphActionRequest } from "../../graph/components/CommitGraph/index.tsx";

export type DragProps = {
	readonly draggable: boolean;
	readonly onDragStart: (event: PointerEvent) => void;
	readonly onCreatePanelDragStart: (
		event: PointerEvent,
		panelId: string,
		completeDrop: () => void,
	) => void;
	readonly onDragEnd: () => void;
};

export type GitOperationResult<Operation extends string> = {
	readonly ok: boolean;
	readonly operation: Operation;
	readonly outcome: GitOperationOutcome;
	readonly currentBranch?: string;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
	readonly error?: string;
};

export type GitRefOperationResult = GitOperationResult<
	| "merge"
	| "rebase"
	| "interactiveRebase"
	| "fastForward"
	| "cherryPick"
	| "revert"
>;

export type GitRefOperationRequest = {
	operation: GitRefOperationResult["operation"];
	action: "start" | "continue" | "skip" | "abort";
	source?: string;
	target?: string;
	steps?: GitInteractiveRebaseStep[];
};

export type GitRefOperationPreflight = {
	readonly source: string;
	readonly target: string;
	readonly validRefs: boolean;
	readonly cleanWorktree: boolean;
	readonly sourceInOtherWorktree: boolean;
	readonly targetInOtherWorktree: boolean;
	readonly canMerge: boolean;
	readonly canFastForward: boolean;
	readonly canRebase: boolean;
	readonly canInteractiveRebase: boolean;
	readonly interactiveRebaseCommits: {
		hash: string;
		message: string;
		author: string;
		date: string;
	}[];
	readonly interactiveRebasePlan: GitInteractiveRebaseStep[];
	readonly reasons: string[];
};

export type GitOperationOutcome =
	| "completed"
	| "awaitingContinuation"
	| "conflicted"
	| "failed";

export type GitOperationActivityPhase =
	| "idle"
	| "running"
	| "conflicted"
	| "awaitingContinuation"
	| "completed"
	| "failed";

export type GitOperationErrorKind =
	| "conflict"
	| "dirtyWorktree"
	| "authentication"
	| "nonFastForward"
	| "network"
	| "worktreeInUse"
	| "invalidInput"
	| "commandFailed"
	| "io";

export type GitGraphActionResult = GitOperationResult<
	GitGraphActionRequest["action"]
>;

export function gitOperationErrorLabel(kind?: GitOperationErrorKind): string {
	switch (kind) {
		case "conflict":
			return "Merge conflict";
		case "dirtyWorktree":
			return "Working tree has changes";
		case "authentication":
			return "Authentication failed";
		case "nonFastForward":
			return "Remote contains newer commits";
		case "network":
			return "Network unavailable";
		case "worktreeInUse":
			return "Branch is open in another worktree";
		case "invalidInput":
			return "Invalid Git action";
		case "io":
			return "Git could not be started";
		default:
			return "Git command failed";
	}
}

export type GraphActionPresentation = {
	readonly title: string;
	readonly copy: string;
	readonly confirm: string;
	readonly needsName: boolean;
	readonly nameLabel?: string;
	readonly messageLabel: string | null;
	readonly danger: boolean;
};

const GRAPH_ACTIONS = {
	createBranch: {
		title: "Create branch",
		copy: "Create a new local branch at the selected commit.",
		needsName: true,
	},
	createTag: {
		title: "Create tag",
		copy: "Create a lightweight tag, or enter a message for an annotated tag.",
		needsName: true,
		messageLabel: "Annotation (optional)",
	},
	cherryPick: {
		title: "Cherry-pick commit",
		copy: "Apply this commit on top of the currently checked-out branch.",
		confirm: "Cherry-pick",
	},
	revert: {
		title: "Revert commit",
		copy: "Create a new commit that reverses the selected commit.",
	},
	stashPush: {
		title: "Stash worktree changes",
		copy: "Store tracked and untracked changes from the current worktree.",
		confirm: "Create stash",
		messageLabel: "Stash message (optional)",
	},
	stashApply: {
		title: "Apply stash",
		copy: "Apply this stash while keeping it in the stash list.",
	},
	stashPop: {
		title: "Pop stash",
		copy: "Apply this stash and remove it if the apply succeeds.",
		danger: true,
	},
	stashDrop: {
		title: "Delete stash",
		copy: "Permanently remove this stash from the repository.",
		danger: true,
	},
	stashRename: {
		title: "Rename stash",
		copy: "Replace this stash's displayed message while preserving its saved tree.",
		needsName: true,
		nameLabel: "New stash message",
	},
	renameBranch: {
		title: "Rename branch",
		copy: "Rename this local branch. Its commits and working tree are preserved.",
		needsName: true,
		nameLabel: "New branch name",
	},
	deleteBranch: {
		title: "Delete local branch",
		copy: "Delete this local branch only if Git confirms it is merged and not checked out in a worktree.",
		confirm: "Delete branch",
		danger: true,
	},
	deleteTag: {
		title: "Delete local tag",
		copy: "Remove this tag from the local repository. Remote tags are unchanged.",
		confirm: "Delete tag",
		danger: true,
	},
	setUpstream: {
		title: "Set branch upstream",
		copy: "Set the tracking branch without pushing or changing either branch.",
		confirm: "Set upstream",
		needsName: true,
		nameLabel: "Upstream (for example origin/main)",
	},
	pushSetUpstream: {
		title: "Push and set upstream",
		copy: "Push this local branch to the named remote and configure it as the tracking upstream.",
		confirm: "Push branch",
		needsName: true,
		nameLabel: "Remote name",
	},
	deleteRemoteBranch: {
		title: "Delete remote branch",
		copy: "Ask the configured remote to permanently delete this branch, then prune its tracking ref.",
		danger: true,
	},
	pushTag: {
		title: "Push tag",
		copy: "Publish this tag to the named remote.",
		needsName: true,
		nameLabel: "Remote name",
	},
	deleteRemoteTag: {
		title: "Delete remote tag",
		copy: "Permanently remove this tag from the named remote. The local tag is kept.",
		needsName: true,
		nameLabel: "Remote name",
		danger: true,
	},
	forcePushWithLease: {
		title: "Force push with lease",
		copy: "Rewrite the configured upstream only if it still points to the commit last fetched locally. This can replace remote history.",
		danger: true,
	},
	resetSoft: {
		title: "Soft reset branch",
		copy: "Move the current branch to this commit while keeping all resulting changes staged.",
		confirm: "Reset --soft",
		danger: true,
	},
	resetMixed: {
		title: "Mixed reset branch",
		copy: "Move the current branch to this commit and keep resulting changes unstaged in the worktree.",
		confirm: "Reset --mixed",
		danger: true,
	},
	resetHard: {
		title: "Hard reset branch",
		copy: "Move the current branch to this commit and permanently discard tracked index and worktree changes.",
		confirm: "Reset --hard",
		danger: true,
	},
	fetch: {
		title: "Fetch all remotes",
		copy: "Update remote-tracking refs and prune deleted remote refs without changing the worktree.",
		confirm: "Fetch",
	},
	pull: {
		title: "Pull current branch",
		copy: "Fetch and integrate the configured upstream using this repository's pull policy.",
		confirm: "Pull",
	},
	push: {
		title: "Push current branch",
		copy: "Push the current branch to its configured upstream. Force push is never used.",
		confirm: "Push",
	},
} satisfies Record<
	GitGraphActionRequest["action"],
	Pick<GraphActionPresentation, "title" | "copy"> &
		Partial<GraphActionPresentation>
>;

export function graphActionPresentation(
	action: GitGraphActionRequest["action"],
): GraphActionPresentation {
	const presentation = GRAPH_ACTIONS[action];
	return {
		needsName: false,
		messageLabel: null,
		danger: false,
		confirm: presentation.title,
		...presentation,
	};
}
