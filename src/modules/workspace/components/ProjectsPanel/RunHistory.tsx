import type { ProjectCatalog } from "@contracts";
import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import {
	projects,
	saveProjectCommand,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { loadCanonicalAgentState } from "../../hooks/useWorkspaceState.tsx";
import {
	loadProjects,
	openRunChat,
	readProjectFile,
} from "../../services/projectsApi.ts";
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
	const [page, setPage] = createSignal<ProjectCatalog | null>(null);
	const [preview, setPreview] = createSignal<{
		name: string;
		content: string;
	} | null>(null);
	const [error, setError] = createSignal("");
	const catalog = () => page() ?? projects.catalog();
	async function inspect(directory: string, path: string) {
		setError("");
		try {
			const file = await readProjectFile(directory, path);
			setPreview({ name: path, content: file.content });
		} catch (e) {
			setError(String(e));
		}
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
			{preview() ? (
				<section {...stylex.attrs(styles.card)}>
					<div {...stylex.attrs(styles.row)}>
						<strong>{preview()!.name}</strong>
						<Button size="sm" onClick={() => setPreview(null)}>
							Close preview
						</Button>
					</div>
					<pre {...stylex.attrs(styles.pre)}>{preview()!.content}</pre>
				</section>
			) : null}
			{!catalog()?.runs.length ? (
				<div {...stylex.attrs(styles.card)}>
					<strong>Your first run starts here</strong>
					<p>
						Run an automation, then inspect its inputs, logs, and files here.
					</p>
				</div>
			) : null}
			{catalog()
				?.runs.filter(
					(run) =>
						!props.automationId || run.automationId === props.automationId,
				)
				.map((run) => (
					<article {...stylex.attrs(styles.card)}>
						<div {...stylex.attrs(styles.row)}>
							<strong>{run.name}</strong>
							<span {...stylex.attrs(styles.badge)}>{run.status}</span>
						</div>
						<span {...stylex.attrs(styles.muted)}>
							{new Date(run.requestedAt).toLocaleString()}
						</span>
						{run.error ? <p role="alert">{run.error}</p> : null}
						{typeof (run.result as { message?: unknown } | null)?.message ===
						"string" ? (
							<p {...stylex.attrs(styles.taskSummary)}>
								{(run.result as { message: string }).message}
							</p>
						) : null}
						{(run.snapshot as { execution: { kind: string } }).execution
							.kind === "agent" &&
						!["running", "queued"].includes(run.status) ? (
							<Button
								size="sm"
								disabled={opening()}
								onClick={() => void continueRun(run.id)}
							>
								Open in chat
							</Button>
						) : null}
						<div {...stylex.attrs(styles.row)}>
							{["queued", "running", "waiting_input"].includes(run.status) ? (
								<Button
									size="sm"
									disabled={projects.busy()}
									onClick={() =>
										void saveProjectCommand({
											type: "stopRun",
											id: run.id,
										}).catch(() => {})
									}
								>
									Stop run
								</Button>
							) : null}
							{["failed", "cancelled", "interrupted", "waiting_input"].includes(
								run.status,
							) ? (
								<Button
									size="sm"
									disabled={projects.busy()}
									onClick={() =>
										void saveProjectCommand({
											type: "retryRun",
											id: run.id,
											requestId: crypto.randomUUID(),
										}).catch(() => {})
									}
								>
									Retry with current inputs
								</Button>
							) : null}
							<Button
								size="sm"
								onClick={() => void inspect(run.directory, "inputs/run.json")}
							>
								Captured inputs
							</Button>
							<Button
								size="sm"
								onClick={() =>
									void inspect(
										run.directory,
										(run.snapshot as { execution: { kind: string } }).execution
											.kind === "agent"
											? "logs/agent.jsonl"
											: "logs/stdout.txt",
									)
								}
							>
								Execution log
							</Button>
							{(run.snapshot as { execution: { kind: string } }).execution
								.kind === "tool" ? (
								<Button
									size="sm"
									onClick={() => void inspect(run.directory, "logs/stderr.txt")}
								>
									Error log
								</Button>
							) : null}
						</div>
						{run.result ? (
							<details>
								<summary>Result</summary>
								<pre {...stylex.attrs(styles.pre)}>
									{JSON.stringify(run.result, null, 2)}
								</pre>
							</details>
						) : null}
						<div {...stylex.attrs(styles.row)}>
							{catalog()
								?.artifacts.filter((a) => a.runId === run.id)
								.map((a) => (
									<Button
										size="sm"
										onClick={() =>
											void inspect(run.directory, `output/${a.name}`)
										}
									>
										{a.name} · {a.byteSize} bytes
									</Button>
								))}
						</div>
						<p {...stylex.attrs(styles.muted)}>{run.directory}</p>
					</article>
				))}
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
