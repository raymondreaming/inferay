import { useCallback, useMemo } from "octane";
import { postJson } from "../../../adapters/backend/http.ts";
import { usePollingQuery } from "../../../shared/hooks/useQueryResource.tsx";
import type { GitProjectStatus } from "../model/types.ts";
import type { useGitGraph } from "./useGitGraph.tsx";

const EMPTY_GIT_PROJECTS: GitProjectStatus[] = [];

export function useGitStatus(
	cwds: string[],
	options: { enabled: boolean; graph?: ReturnType<typeof useGitGraph> },
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
			postJson<GitProjectStatus[]>(
				"/api/git/statuses",
				{ cwds: requestedCwds },
				{ signal },
			),
		[requestedCwds],
	);
	const {
		data,
		setData,
		refetch: refreshStatuses,
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
	const updateGraphStatus = graph?.updateWorktreeStatus;
	const applyOptimistic = useCallback(
		(cwd: string, mutator: (project: GitProjectStatus) => GitProjectStatus) => {
			if (graphProjects.some((project) => project.cwd === cwd)) {
				updateGraphStatus?.(cwd, mutator);
			} else {
				setData((current) =>
					current.map((project) =>
						project.cwd === cwd ? mutator(project) : project,
					),
				);
			}
		},
		[graphProjects, setData, updateGraphStatus],
	);
	return {
		projects,
		projectMap,
		refetch,
		applyOptimistic,
		loaded: !options.enabled || requestedCwds.length === 0 || loaded,
	};
}
