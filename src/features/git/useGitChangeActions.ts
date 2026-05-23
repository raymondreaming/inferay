import { useCallback, useState } from "react";
import type { GitProjectStatus } from "./types.ts";

export function useGitChangeActions({
	cwd,
	onRefresh,
	applyOptimistic,
	refetchStatus,
}: {
	cwd?: string;
	onRefresh?: () => void;
	/** Apply an instant local mutation for the current cwd's git status. */
	applyOptimistic?: (
		cwd: string,
		mutator: (p: GitProjectStatus) => GitProjectStatus
	) => void;
	/** Force a server-truth refetch (called after a fire-and-forget mutation). */
	refetchStatus?: () => undefined | Promise<unknown>;
}) {
	const [commitMessage, setCommitMessage] = useState("");
	const [isCommitting, setIsCommitting] = useState(false);
	const [amendMode, setAmendMode] = useState(false);

	// Fire a git mutation in the background and reconcile when it settles.
	// Callers apply optimistic UI updates first so the user sees the result
	// instantly regardless of HTTP latency.
	const gitAction = useCallback(
		(endpoint: string, body: object) => {
			void fetch(`/api/git/${endpoint}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
				.catch(() => {
					/* swallow; refetch below restores truth */
				})
				.finally(() => {
					if (refetchStatus) void refetchStatus();
					onRefresh?.();
				});
		},
		[onRefresh, refetchStatus]
	);

	const stageMutation = useCallback(
		(staged: boolean, file?: string) => {
			if (!cwd) return;
			applyOptimistic?.(cwd, (p) => {
				if (file) {
					// Single-file toggle: O(1) count adjustment when state actually changes.
					const target = p.files.find((f) => f.path === file);
					const changed = !!target && target.staged !== staged;
					return {
						...p,
						files: changed
							? p.files.map((f) => (f.path === file ? { ...f, staged } : f))
							: p.files,
						stagedCount: changed
							? p.stagedCount + (staged ? 1 : -1)
							: p.stagedCount,
						unstagedCount: changed
							? p.unstagedCount + (staged ? -1 : 1)
							: p.unstagedCount,
					};
				}
				// Bulk stage/unstage: counts are deterministic from total file count.
				return {
					...p,
					files: p.files.map((f) => ({ ...f, staged })),
					stagedCount: staged ? p.files.length : 0,
					unstagedCount: staged ? 0 : p.files.length,
				};
			});
			gitAction(staged ? "stage" : "unstage", file ? { cwd, file } : { cwd });
		},
		[cwd, gitAction, applyOptimistic]
	);

	const stageFile = useCallback(
		(file: string) => stageMutation(true, file),
		[stageMutation]
	);
	const unstageFile = useCallback(
		(file: string) => stageMutation(false, file),
		[stageMutation]
	);
	const stageAll = useCallback(() => stageMutation(true), [stageMutation]);
	const unstageAll = useCallback(() => stageMutation(false), [stageMutation]);

	const commit = useCallback(async () => {
		if (!cwd || !commitMessage.trim() || isCommitting) return;
		setIsCommitting(true);
		const controller = new AbortController();
		const timeout = setTimeout(controller.abort.bind(controller), 35_000);
		try {
			const response = await fetch("/api/git/commit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd, message: commitMessage }),
				signal: controller.signal,
			});
			const result = (await response.json()) as { success?: boolean };
			if (result.success) {
				setCommitMessage("");
				if (refetchStatus) void refetchStatus();
				onRefresh?.();
			}
		} finally {
			clearTimeout(timeout);
			setIsCommitting(false);
		}
	}, [cwd, commitMessage, isCommitting, onRefresh, refetchStatus]);

	return {
		commit,
		commitMessage,
		setCommitMessage,
		isCommitting,
		amendMode,
		setAmendMode,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	};
}
