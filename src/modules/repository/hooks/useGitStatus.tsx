import type { GitStatusResult } from "@contracts";
import {
	commitGitChanges,
	loadGitStatuses,
	runGitChangeAction,
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
	const refreshGraph = createMemo(() => graph()?.refresh);
	const refetch = async () => {
		await Promise.all([
			requestedCwds().length > 0 ? _source.refresh() : undefined,
			refreshGraph()?.(),
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
	const stageMutation = (staged: boolean, file?: string) => {
		if (!_options2().cwd) return;
		gitAction(staged ? "stage" : "unstage", file || undefined);
	};
	const stageFile = (file: string) => stageMutation(true, file);
	const unstageFile = (file: string) => stageMutation(false, file);
	const stageAll = () => stageMutation(true);
	const unstageAll = () => stageMutation(false);
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
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
	};
}
