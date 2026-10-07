import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";
import {
	projects,
	saveProjectCommand,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { loadCanonicalAgentState } from "../../hooks/useWorkspaceState.tsx";
import type { ProjectWorkspaceView } from "../../model/projectFiles.ts";
import { loadProjects, openRunChat } from "../../services/projectsApi.ts";
import { RunFilePreview } from "./RunFilePreview.tsx";
import { styles } from "./styles.ts";

export function RunHistory(props: { automationId?: string } = {}) {
	const [opening, setOpening] = createSignal(false);
	async function continueRun(id: string) {
		setOpening(true);
		setError("");
		try {
			await openRunChat(id);
			await loadCanonicalAgentState();
			showProjectView("chat");
		} catch (e) {
			setError(String(e));
		} finally {
			setOpening(false);
		}
	}
	const [page, setPage] = createSignal<ProjectWorkspaceView | null>(null);
	const [preview, setPreview] = createSignal<{
		directory: string;
		path: string;
	} | null>(null);
	const [error, setError] = createSignal("");
	const catalog = () => page() ?? projects.catalog();
	function inspect(directory: string, path: string) {
		setPreview({ directory, path });
	}
	async function older() {
		try {
			setPage(
				await loadProjects(
					projects.selectedId(),
					catalog()?.nextRunCursor ?? undefined,
				),
			);
		} catch (e) {
			setError(String(e));
		}
	}
	return (
		<>
			<p {...stylex.attrs(styles.muted)}>
				Recent automation runs, captured inputs, and generated files.
			</p>
			{error() ? <p role="alert">{error()}</p> : null}
			<Show when={preview()} keyed>
				{(file) => <RunFilePreview {...file} close={() => setPreview(null)} />}
			</Show>
			{!catalog()?.runs.length ? (
				<div {...stylex.attrs(styles.card)}>
					<strong>Your first run starts here</strong>
					<p>
						Run an automation, then inspect its inputs, logs, and files here.
					</p>
				</div>
			) : null}
			<For
				each={catalog()?.runs.filter(
					(run) =>
						!props.automationId || run.automationId === props.automationId,
				)}
				keyed={(item) => item.id}
			>
				{(run) => (
					<article {...stylex.attrs(styles.card)}>
						<div {...stylex.attrs(styles.row)}>
							<strong>{run().name}</strong>
							<span {...stylex.attrs(styles.badge)}>{run().status}</span>
						</div>
						<span {...stylex.attrs(styles.muted)}>
							{new Date(run().requestedAt).toLocaleString()}
						</span>
						<Show when={run().usage}>
							{(usage) => (
								<div
									aria-label="Provider usage"
									{...stylex.attrs(styles.row, styles.muted)}
								>
									<span>
										{usage().inputTokens === null
											? "Input unknown"
											: `${usage().inputTokens?.toLocaleString()} input tokens`}
									</span>
									<span>
										{usage().outputTokens === null
											? "Output unknown"
											: `${usage().outputTokens?.toLocaleString()} output tokens`}
									</span>
									{usage().cachedInputTokens !== null && (
										<span>
											{usage().cachedInputTokens?.toLocaleString()} cached input
										</span>
									)}
									{usage().reportedCostUsd !== null && (
										<span>
											{new Intl.NumberFormat(undefined, {
												style: "currency",
												currency: "USD",
												maximumFractionDigits: 4,
											}).format(usage().reportedCostUsd!)}{" "}
											reported cost
										</span>
									)}
								</div>
							)}
						</Show>
						{run().error ? <p role="alert">{run().error}</p> : null}
						{typeof (run().result as { message?: unknown } | null)?.message ===
						"string" ? (
							<p {...stylex.attrs(styles.taskSummary)}>
								{(run().result as { message: string }).message}
							</p>
						) : null}
						{run().conversationAvailable ? (
							<Button
								size="sm"
								disabled={opening()}
								onClick={() => void continueRun(run().id)}
							>
								Open in chat
							</Button>
						) : null}
						<div {...stylex.attrs(styles.row)}>
							{["queued", "running", "waiting_input"].includes(run().status) ? (
								<Button
									size="sm"
									disabled={projects.busy()}
									onClick={() =>
										void saveProjectCommand({
											type: "stopRun",
											id: run().id,
										}).catch(() => {})
									}
								>
									Stop run
								</Button>
							) : null}
							{["failed", "cancelled", "interrupted", "waiting_input"].includes(
								run().status,
							) ? (
								<Button
									size="sm"
									disabled={projects.busy()}
									onClick={() =>
										void saveProjectCommand({
											type: "retryRun",
											id: run().id,
											requestId: crypto.randomUUID(),
										}).catch(() => {})
									}
								>
									Retry with current inputs
								</Button>
							) : null}
							<Button
								size="sm"
								onClick={() => void inspect(run().directory, "inputs/run.json")}
							>
								Captured inputs
							</Button>
							<Button
								size="sm"
								onClick={() =>
									void inspect(
										run().directory,
										(run().snapshot as { execution?: { kind?: string } } | null)
											?.execution?.kind === "agent"
											? "logs/agent.jsonl"
											: "logs/stdout.txt",
									)
								}
							>
								Execution log
							</Button>
							{(run().snapshot as { execution?: { kind?: string } } | null)
								?.execution?.kind === "tool" ? (
								<Button
									size="sm"
									onClick={() =>
										void inspect(run().directory, "logs/stderr.txt")
									}
								>
									Error log
								</Button>
							) : null}
						</div>
						{run().result ? (
							<details>
								<summary>Result</summary>
								<pre {...stylex.attrs(styles.pre)}>
									{JSON.stringify(run().result, null, 2)}
								</pre>
							</details>
						) : null}
						<div {...stylex.attrs(styles.row)}>
							<For
								each={catalog()?.artifacts.filter((a) => a.runId === run().id)}
								keyed={(item) => item.id}
							>
								{(a) => (
									<Button
										size="sm"
										onClick={() =>
											void inspect(run().directory, `output/${a().name}`)
										}
									>
										{a().name} · {a().byteSize} bytes
									</Button>
								)}
							</For>
						</div>
						<p {...stylex.attrs(styles.muted)}>{run().directory}</p>
					</article>
				)}
			</For>
			<div {...stylex.attrs(styles.row)}>
				{page() ? (
					<Button size="sm" onClick={() => setPage(null)}>
						Latest runs
					</Button>
				) : null}
				{catalog()?.hasMoreRuns ? (
					<Button size="sm" onClick={() => void older()}>
						Older runs
					</Button>
				) : null}
			</div>
		</>
	);
}
