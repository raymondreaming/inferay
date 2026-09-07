import { type Accessor, createMemo, createSignal } from "solid-js";
import type { GitStatusResult } from "../../../../build/presentation/contracts/GitStatusResult.ts";
import { usePollingQuery } from "../../../shared/hooks/useQueryResource.tsx";
import { postJson, sendJson } from "../../../shared/lib/native.tsx";
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
	const fetcher = (signal?: AbortSignal) =>
		postJson<GitStatusResult[]>(
			"/api/git/statuses",
			{
				cwds: requestedCwds(),
			},
			{
				signal,
			},
		);
	const _source = usePollingQuery(
		() => fetcher,
		() => 5000,
		() => EMPTY_GIT_PROJECTS,
		() => ({
			queryKey: ["git", "status", cwdKey()],
			staleTime: 0,
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
		get refetch() {
			return refetch;
		},
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
	const gitAction = (endpoint: string, body: object) => {
		void sendJson(`/api/git/${endpoint}`, body)
			.catch(() => {
				/* swallow; refetch below restores truth */
			})
			.finally(() => {
				void _options2().refetchStatus();
			});
	};
	const stageMutation = (staged: boolean, file?: string) => {
		const _options2Value = _options2();
		if (!_options2Value.cwd) return;
		gitAction(staged ? "stage" : "unstage", {
			cwd: _options2Value.cwd,
			file: file || undefined,
		});
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
			const response = await sendJson(
				"/api/git/commit",
				{
					cwd: _options2Value2.cwd,
					message: _commitMessageValue,
				},
				{
					signal: AbortSignal.timeout(35_000),
				},
			);
			const result = (await response.json()) as {
				success?: boolean;
			};
			if (result.success) {
				setCommitMessage("");
				void _options2Value2.refetchStatus();
			}
		} finally {
			setIsCommitting(false);
		}
	};
	return {
		get commit() {
			return commit;
		},
		get commitMessage() {
			return commitMessage();
		},
		get setCommitMessage() {
			return setCommitMessage;
		},
		get isCommitting() {
			return isCommitting();
		},
		get stageFile() {
			return stageFile;
		},
		get unstageFile() {
			return unstageFile;
		},
		get stageAll() {
			return stageAll;
		},
		get unstageAll() {
			return unstageAll;
		},
	};
}
