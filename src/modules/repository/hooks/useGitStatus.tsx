import { useCallback, useMemo, useState } from "octane";
import type { GitStatusResult } from "../../../../build/presentation/contracts/GitStatusResult.ts";
import { postJson, sendJson } from "../../../adapters/backend/http.ts";
import { usePollingQuery } from "../../../shared/hooks/useQueryResource.tsx";
import type { useGitGraph } from "./useGitGraph.tsx";

const EMPTY_GIT_PROJECTS: GitStatusResult[] = [];
export function useGitStatus(
	cwds: string[],
	options: {
		enabled: boolean;
		graph?: ReturnType<typeof useGitGraph>;
	},
) {
	const graph = options.graph;
	const graphProjects = useMemo(
		() =>
			graph?.revision && !graph.error && graph.state !== "commandFailed"
				? graph.worktrees.flatMap((worktree) =>
						worktree.status ? [worktree.status] : [],
					)
				: EMPTY_GIT_PROJECTS,
		[graph?.revision, graph?.error, graph?.state, graph?.worktrees],
	);
	const cwdKey = cwds
		.filter((cwd) => !graphProjects.some((project) => project.cwd === cwd))
		.join("\u0000");
	const requestedCwds = useMemo(
		() => (cwdKey ? cwdKey.split("\u0000") : []),
		[cwdKey],
	);
	const fetcher = useCallback(
		(signal?: AbortSignal) =>
			postJson<GitStatusResult[]>(
				"/api/git/statuses",
				{
					cwds: requestedCwds,
				},
				{
					signal,
				},
			),
		[requestedCwds],
	);
	const {
		data,
		refresh: refreshStatuses,
		loaded,
	} = usePollingQuery(fetcher, 5000, EMPTY_GIT_PROJECTS, {
		queryKey: ["git", "status", cwdKey],
		staleTime: 0,
		enabled: options.enabled && requestedCwds.length > 0,
	});
	const projects = useMemo(
		() =>
			[...data, ...graphProjects].filter((project) =>
				cwds.includes(project.cwd),
			),
		[data, graphProjects, cwds],
	);
	const projectMap = useMemo(
		() => new Map(projects.map((project) => [project.cwd, project])),
		[projects],
	);
	const refreshGraph = graph?.refresh;
	const refetch = useCallback(async () => {
		await Promise.all([
			requestedCwds.length > 0 ? refreshStatuses() : undefined,
			refreshGraph?.(),
		]);
	}, [refreshStatuses, refreshGraph, requestedCwds]);
	return {
		projects,
		projectMap,
		refetch,
		loaded: !options.enabled || requestedCwds.length === 0 || loaded,
	};
}

export function useGitChangeActions({
	cwd,
	refetchStatus,
}: {
	cwd?: string;
	refetchStatus: () => undefined | Promise<unknown>;
}) {
	const [commitMessage, setCommitMessage] = useState("");
	const [isCommitting, setIsCommitting] = useState(false);

	const gitAction = useCallback(
		(endpoint: string, body: object) => {
			void sendJson(`/api/git/${endpoint}`, body)
				.catch(() => {
					/* swallow; refetch below restores truth */
				})
				.finally(() => {
					void refetchStatus();
				});
		},
		[refetchStatus],
	);
	const stageMutation = useCallback(
		(staged: boolean, file?: string) => {
			if (!cwd) return;
			gitAction(staged ? "stage" : "unstage", { cwd, file: file || undefined });
		},
		[cwd, gitAction],
	);
	const stageFile = useCallback(
		(file: string) => stageMutation(true, file),
		[stageMutation],
	);
	const unstageFile = useCallback(
		(file: string) => stageMutation(false, file),
		[stageMutation],
	);
	const stageAll = useCallback(() => stageMutation(true), [stageMutation]);
	const unstageAll = useCallback(() => stageMutation(false), [stageMutation]);
	const commit = useCallback(async () => {
		if (!cwd || !commitMessage.trim() || isCommitting) return;
		setIsCommitting(true);
		try {
			const response = await sendJson(
				"/api/git/commit",
				{ cwd, message: commitMessage },
				{ signal: AbortSignal.timeout(35_000) },
			);
			const result = (await response.json()) as { success?: boolean };
			if (result.success) {
				setCommitMessage("");
				void refetchStatus();
			}
		} finally {
			setIsCommitting(false);
		}
	}, [cwd, commitMessage, isCommitting, refetchStatus]);
	return {
		commit,
		commitMessage,
		setCommitMessage,
		isCommitting,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	};
}
