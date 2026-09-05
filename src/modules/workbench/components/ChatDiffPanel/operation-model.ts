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

export type GitRefOperationResult = {
	readonly ok: boolean;
	readonly operation:
		| "merge"
		| "rebase"
		| "interactiveRebase"
		| "fastForward"
		| "cherryPick"
		| "revert";
	readonly outcome: GitOperationOutcome;
	readonly currentBranch?: string;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
	readonly error?: string;
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

export type GitGraphActionResult = {
	readonly ok: boolean;
	readonly action: GitGraphActionRequest["action"];
	readonly outcome: GitOperationOutcome;
	readonly currentBranch?: string;
	readonly head?: string;
	readonly conflicts: string[];
	readonly errorKind?: GitOperationErrorKind;
	readonly error?: string;
};

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

export function graphActionPresentation(
	action: GitGraphActionRequest["action"],
): GraphActionPresentation {
	switch (action) {
		case "createBranch":
			return {
				title: "Create branch",
				copy: "Create a new local branch at the selected commit.",
				confirm: "Create branch",
				needsName: true,
				messageLabel: null,
				danger: false,
			};
		case "createTag":
			return {
				title: "Create tag",
				copy: "Create a lightweight tag, or enter a message for an annotated tag.",
				confirm: "Create tag",
				needsName: true,
				messageLabel: "Annotation (optional)",
				danger: false,
			};
		case "cherryPick":
			return {
				title: "Cherry-pick commit",
				copy: "Apply this commit on top of the currently checked-out branch.",
				confirm: "Cherry-pick",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "revert":
			return {
				title: "Revert commit",
				copy: "Create a new commit that reverses the selected commit.",
				confirm: "Revert commit",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "stashPush":
			return {
				title: "Stash worktree changes",
				copy: "Store tracked and untracked changes from the current worktree.",
				confirm: "Create stash",
				needsName: false,
				messageLabel: "Stash message (optional)",
				danger: false,
			};
		case "stashApply":
			return {
				title: "Apply stash",
				copy: "Apply this stash while keeping it in the stash list.",
				confirm: "Apply stash",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "stashPop":
			return {
				title: "Pop stash",
				copy: "Apply this stash and remove it if the apply succeeds.",
				confirm: "Pop stash",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "stashDrop":
			return {
				title: "Delete stash",
				copy: "Permanently remove this stash from the repository.",
				confirm: "Delete stash",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "stashRename":
			return {
				title: "Rename stash",
				copy: "Replace this stash's displayed message while preserving its saved tree.",
				confirm: "Rename stash",
				needsName: true,
				nameLabel: "New stash message",
				messageLabel: null,
				danger: false,
			};
		case "renameBranch":
			return {
				title: "Rename branch",
				copy: "Rename this local branch. Its commits and working tree are preserved.",
				confirm: "Rename branch",
				needsName: true,
				nameLabel: "New branch name",
				messageLabel: null,
				danger: false,
			};
		case "deleteBranch":
			return {
				title: "Delete local branch",
				copy: "Delete this local branch only if Git confirms it is merged and not checked out in a worktree.",
				confirm: "Delete branch",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "deleteTag":
			return {
				title: "Delete local tag",
				copy: "Remove this tag from the local repository. Remote tags are unchanged.",
				confirm: "Delete tag",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "setUpstream":
			return {
				title: "Set branch upstream",
				copy: "Set the tracking branch without pushing or changing either branch.",
				confirm: "Set upstream",
				needsName: true,
				nameLabel: "Upstream (for example origin/main)",
				messageLabel: null,
				danger: false,
			};
		case "pushSetUpstream":
			return {
				title: "Push and set upstream",
				copy: "Push this local branch to the named remote and configure it as the tracking upstream.",
				confirm: "Push branch",
				needsName: true,
				nameLabel: "Remote name",
				messageLabel: null,
				danger: false,
			};
		case "deleteRemoteBranch":
			return {
				title: "Delete remote branch",
				copy: "Ask the configured remote to permanently delete this branch, then prune its tracking ref.",
				confirm: "Delete remote branch",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "pushTag":
			return {
				title: "Push tag",
				copy: "Publish this tag to the named remote.",
				confirm: "Push tag",
				needsName: true,
				nameLabel: "Remote name",
				messageLabel: null,
				danger: false,
			};
		case "deleteRemoteTag":
			return {
				title: "Delete remote tag",
				copy: "Permanently remove this tag from the named remote. The local tag is kept.",
				confirm: "Delete remote tag",
				needsName: true,
				nameLabel: "Remote name",
				messageLabel: null,
				danger: true,
			};
		case "forcePushWithLease":
			return {
				title: "Force push with lease",
				copy: "Rewrite the configured upstream only if it still points to the commit last fetched locally. This can replace remote history.",
				confirm: "Force push with lease",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "resetSoft":
			return {
				title: "Soft reset branch",
				copy: "Move the current branch to this commit while keeping all resulting changes staged.",
				confirm: "Reset --soft",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "resetMixed":
			return {
				title: "Mixed reset branch",
				copy: "Move the current branch to this commit and keep resulting changes unstaged in the worktree.",
				confirm: "Reset --mixed",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "resetHard":
			return {
				title: "Hard reset branch",
				copy: "Move the current branch to this commit and permanently discard tracked index and worktree changes.",
				confirm: "Reset --hard",
				needsName: false,
				messageLabel: null,
				danger: true,
			};
		case "fetch":
			return {
				title: "Fetch all remotes",
				copy: "Update remote-tracking refs and prune deleted remote refs without changing the worktree.",
				confirm: "Fetch",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "pull":
			return {
				title: "Pull current branch",
				copy: "Fetch and integrate the configured upstream using this repository's pull policy.",
				confirm: "Pull",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
		case "push":
			return {
				title: "Push current branch",
				copy: "Push the current branch to its configured upstream. Force push is never used.",
				confirm: "Push",
				needsName: false,
				messageLabel: null,
				danger: false,
			};
	}
}
