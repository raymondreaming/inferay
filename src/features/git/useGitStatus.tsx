import { useCallback, useMemo, useState } from "octane";
import { usePollingQuery } from "../../hooks/useQueryResource.tsx";
import { postJson } from "../../lib/fetch-json.ts";
import type { GitProjectStatus } from "./types.ts";

function areGitStatusesEqual(
	prev: GitProjectStatus[],
	next: GitProjectStatus[],
) {
	if (prev.length !== next.length) return false;
	for (let i = 0; i < prev.length; i++) {
		const a = prev[i]!;
		const b = next[i]!;
		if (
			a.cwd !== b.cwd ||
			a.name !== b.name ||
			a.branch !== b.branch ||
			a.upstream !== b.upstream ||
			a.ahead !== b.ahead ||
			a.behind !== b.behind ||
			a.stagedCount !== b.stagedCount ||
			a.unstagedCount !== b.unstagedCount ||
			a.untrackedCount !== b.untrackedCount ||
			a.files.length !== b.files.length
		)
			return false;
		for (let j = 0; j < a.files.length; j++) {
			const af = a.files[j]!;
			const bf = b.files[j]!;
			if (
				af.status !== bf.status ||
				af.staged !== bf.staged ||
				af.path !== bf.path ||
				af.originalPath !== bf.originalPath ||
				af.additions !== bf.additions ||
				af.deletions !== bf.deletions
			)
				return false;
		}
	}
	return true;
}

export function useGitStatus(cwds: string[], options?: { enabled?: boolean }) {
	const enabled = options?.enabled ?? cwds.length > 0;
	const cwdKey = cwds.join("\u0000");
	const requestedCwds = useMemo(
		() => (cwdKey ? cwdKey.split("\u0000") : []),
		[cwdKey],
	);
	const [loadedCwdKey, setLoadedCwdKey] = useState("");
	const fetcher = useCallback(
		async (signal?: AbortSignal) => {
			if (requestedCwds.length === 0) {
				setLoadedCwdKey(cwdKey);
				return [];
			}
			const result = await postJson<GitProjectStatus[]>(
				"/api/git/statuses",
				{ cwds: requestedCwds },
				{ signal },
			);
			if (!signal?.aborted) setLoadedCwdKey(cwdKey);
			return result;
		},
		[cwdKey, requestedCwds],
	);

	const {
		data: projects,
		setData,
		refetch,
		loaded,
	} = usePollingQuery<GitProjectStatus[]>(fetcher, 5000, [], {
		queryKey: ["git", "status", cwdKey],
		enabled,
		isEqual: areGitStatusesEqual,
	});
	const statusLoaded = !enabled || (loaded && loadedCwdKey === cwdKey);

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
		[setData],
	);

	return {
		projects,
		projectMap,
		refetch,
		applyOptimistic,
		loaded: statusLoaded,
	};
}
