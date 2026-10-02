import type { GitStatusResult } from "@contracts";
import {
	commitGitChanges,
	discardGitChanges,
	loadGitStatuses,
	runGitChangeAction,
	stashGitFile,
} from "@repository/services/gitApi.ts";
import { usePollingQuery } from "@shared/hooks/useQueryResource.tsx";
import { type Accessor, createMemo, createSignal } from "solid-js";
import type { useGitGraph } from "./useGitGraph.tsx";

const EMPTY_GIT_PROJECTS: GitStatusResult[] = [];
export function useGitStatus(
	_cwds: Accessor<string[]>,
	_options: Accessor<{
		enabled: boolean;
		graph?: ReturnType<typeof useGitGraph>;
	}>,
) {
	const graph = createMemo(() => _options().graph);
	const graphProjects = createMemo(() => {
		const _graphValue = graph();
		return _graphValue?.revision &&
			!_graphValue.error &&
			_graphValue.state !== "commandFailed"
			? _graphValue.worktrees.flatMap((worktree) =>
					worktree.status ? [worktree.status] : [],
				)
			: EMPTY_GIT_PROJECTS;
	});
	const cwdKey = createMemo(() =>
		_cwds()
			.filter((cwd) => !graphProjects().some((project) => project.cwd === cwd))
			.join("\u0000"),
	);
	const requestedCwds = createMemo(() => {
		const _cwdKeyValue = cwdKey();
		return _cwdKeyValue ? _cwdKeyValue.split("\u0000") : [];
	});
	const _source = usePollingQuery(
		() => {
			const cwds = requestedCwds();
			return (signal) => loadGitStatuses(cwds, signal);
		},
		() => 5000,
		() => EMPTY_GIT_PROJECTS,
		() => ({
			queryKey: ["git", "status", cwdKey()],
			enabled: _options().enabled && requestedCwds().length > 0,
		}),
	);
	const projects = createMemo(() =>
		[..._source.data, ...graphProjects()].filter((project) =>
			_cwds().includes(project.cwd),
		),
	);
	const projectMap = createMemo(
		() => new Map(projects().map((project) => [project.cwd, project])),
	);
	const refetch = async () => {
		await Promise.all([
			requestedCwds().length > 0 ? _source.refresh() : undefined,
			graph()?.refresh(),
		]);
	};
	return {
		get projects() {
			return projects();
		},
		get projectMap() {
			return projectMap();
		},
		refetch,
		get loaded() {
			return (
				!_options().enabled || requestedCwds().length === 0 || _source.loaded
			);
		},
	};
}
export function useGitChangeActions(
	_options2: Accessor<{
		cwd?: string;
		refetchStatus: () => undefined | Promise<unknown>;
	}>,
) {
	const [commitMessage, setCommitMessage] = createSignal("");
	const [isCommitting, setIsCommitting] = createSignal(false);
	const gitAction = (action: "stage" | "unstage", file?: string) => {
		const cwd = _options2().cwd;
		if (!cwd) return;
		void runGitChangeAction(cwd, action, file)
			.catch(() => {
				/* swallow; refetch below restores truth */
			})
			.finally(() => {
				void _options2().refetchStatus();
			});
	};
	const runReported = (work: (cwd: string) => Promise<void>) => {
		const cwd = _options2().cwd;
		if (!cwd) return;
		void work(cwd)
			.catch((error: unknown) => {
				alert(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				void _options2().refetchStatus();
			});
	};
	const commit = async () => {
		const _options2Value2 = _options2(),
			_commitMessageValue = commitMessage();
		if (!_options2Value2.cwd || !_commitMessageValue.trim() || isCommitting())
			return;
		setIsCommitting(true);
		try {
			if (await commitGitChanges(_options2Value2.cwd, _commitMessageValue)) {
				setCommitMessage("");
				void _options2Value2.refetchStatus();
			}
		} finally {
			setIsCommitting(false);
		}
	};
	return {
		commit,
		get commitMessage() {
			return commitMessage();
		},
		setCommitMessage,
		get isCommitting() {
			return isCommitting();
		},
		stageFile: (file: string) => gitAction("stage", file || undefined),
		unstageFile: (file: string) => gitAction("unstage", file || undefined),
		stageAll: () => gitAction("stage"),
		unstageAll: () => gitAction("unstage"),
		stashFile: (file: string) => runReported((cwd) => stashGitFile(cwd, file)),
		discard: (staged: boolean, file?: string) => {
			const scope = staged ? "staged" : "unstaged";
			const prompt = file
				? `Discard ${scope} changes to ${file}?`
				: `Discard all ${scope} changes?${staged ? "" : " Staged changes are kept. New untracked files are deleted."}`;
			if (!confirm(`${prompt} This cannot be undone.`)) return;
			runReported((cwd) => discardGitChanges(cwd, staged, file));
		},
	};
}
