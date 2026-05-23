import { useCallback, useMemo } from "react";
import { postJson } from "../../lib/fetch-json.ts";
import { usePollingResource } from "../../hooks/usePollingResource.ts";
import type { GitProjectStatus } from "./types.ts";

export function useGitStatus(cwds: string[]) {
	const fetcher = useCallback(
		async () => {
			if (cwds.length === 0) return [];
			return postJson<GitProjectStatus[]>("/api/git/statuses", { cwds });
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[cwds]
	);

	const {
		data: projects,
		setData,
		refetch,
	} = usePollingResource<GitProjectStatus[]>(fetcher, 5000, [], {
		deferInitialFetch: true,
	});

	const projectMap = useMemo(() => {
		const map = new Map<string, GitProjectStatus>();
		for (const p of projects) map.set(p.cwd, p);
		return map;
	}, [projects]);

	// Apply an optimistic update to a single project's status. Used to make
	// stage / unstage feel instant — the actual git command runs in the
	// background and a subsequent refetch reconciles with server truth.
	const applyOptimistic = useCallback(
		(cwd: string, mutator: (project: GitProjectStatus) => GitProjectStatus) => {
			setData((prev) => prev.map((p) => (p.cwd === cwd ? mutator(p) : p)));
		},
		[setData]
	);

	return { projects, projectMap, refetch, applyOptimistic };
}
