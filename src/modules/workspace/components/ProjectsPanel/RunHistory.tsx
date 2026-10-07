import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
	projects,
	refreshProjects,
	saveProjectCommand,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { loadCanonicalAgentState } from "../../hooks/useWorkspaceState.tsx";
import type { ProjectWorkspaceView } from "../../model/projectFiles.ts";
import { loadProjects, openRunChat } from "../../services/projectsApi.ts";
import { RunFilePreview } from "./RunFilePreview.tsx";
import { styles } from "./styles.ts";

export function RunHistory(props: {
	automationId?: string;
	selectAutomation: (id: string) => void;
}) {
	const [opening, setOpening] = createSignal(false);
	async function continueRun(id: string) {
		if (opening()) return;
		setOpening(true);
		setError("");
		try {
			await openRunChat(id);
			await loadCanonicalAgentState();
			await refreshProjects();
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
	const upcoming = createMemo(() =>
		(projects.catalog()?.automations ?? [])
			.filter(
				(automation) =>
					automation.enabled &&
					!automation.archived &&
					automation.nextDueAt !== null &&
					(!props.automationId || automation.id === props.automationId),
			)
			.sort((a, b) => a.nextDueAt! - b.nextDueAt!),
	);
	const runs = createMemo(() =>
		(catalog()?.runs ?? []).filter(
			(run) => !props.automationId || run.automationId === props.automationId,
		),
	);

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
			<Show when={!page() && upcoming().length > 0}>
				<section
					aria-label="Upcoming automations"
					{...stylex.attrs(styles.historyUpcoming)}
				>
					<strong {...stylex.attrs(styles.sectionLabel)}>Up next</strong>
					<p {...stylex.attrs(styles.muted)}>Runs while Inferay is open</p>
					<For each={upcoming()} keyed={(automation) => automation.id}>
						{(automation) => (
							<div {...stylex.attrs(styles.row)}>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => props.selectAutomation(automation().id)}
								>
									{automation().name}
								</Button>
								<time
									datetime={new Date(automation().nextDueAt!).toISOString()}
									{...stylex.attrs(styles.muted)}
								>
									{new Date(automation().nextDueAt!).toLocaleString(undefined, {
										dateStyle: "medium",
										timeStyle: "short",
									})}
								</time>
							</div>
						)}
					</For>
				</section>
			</Show>
			{error() ? <p role="alert">{error()}</p> : null}
			<Show when={preview()} keyed>
				{(file) => <RunFilePreview {...file} close={() => setPreview(null)} />}
			</Show>
			{!runs().length ? (
				<div {...stylex.attrs(styles.card)}>
					<strong>Your first run starts here</strong>
					<p>
						Run an automation, then inspect its inputs, logs, and files here.
					</p>
				</div>
			) : null}
			<For each={runs()} keyed={(item) => item.id}>
				{(run) => (
					<article {...stylex.attrs(styles.historyRun)}>
						<div {...stylex.attrs(styles.historyHeader)}>
							<div {...stylex.attrs(styles.historyIdentity)}>
								<span {...stylex.attrs(styles.historyStatus)}>
									{run().status === "succeeded" &&
									(run().snapshot as { execution?: { kind?: string } } | null)
										?.execution?.kind === "agent"
										? "Agent finished"
										: run().status.replaceAll("_", " ")}
								</span>
								<Show
									when={run().conversationAvailable}
									fallback={<strong>{run().name}</strong>}
								>
									<Button
										size="sm"
										variant="ghost"
										disabled={opening()}
										onClick={() => void continueRun(run().id)}
										{...stylex.attrs(styles.historyTitle)}
									>
										<strong>{run().name}</strong>
									</Button>
								</Show>
								<time
									{...stylex.attrs(styles.muted)}
									datetime={new Date(run().requestedAt).toISOString()}
								>
									{new Date(run().requestedAt).toLocaleString(undefined, {
										dateStyle: "medium",
										timeStyle: "short",
									})}
								</time>
							</div>
							<div {...stylex.attrs(styles.row)}>
								{["queued", "running", "waiting_input"].includes(
									run().status,
								) ? (
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
								{run().conversationAvailable ? (
									<Button
										size="sm"
										disabled={opening()}
										onClick={() => void continueRun(run().id)}
									>
										{["running", "queued", "waiting_input"].includes(
											run().status,
										)
											? "Open progress in chat"
											: "Open in chat"}
									</Button>
								) : null}
							</div>
						</div>
						{run().error ? <p role="alert">{run().error}</p> : null}
						{typeof (run().result as { message?: unknown } | null)?.message ===
						"string" ? (
							<p {...stylex.attrs(styles.taskSummary)}>
								{(run().result as { message: string }).message}
							</p>
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
						<For
							each={catalog()?.effects.filter(
								(effect) => effect.runId === run().id,
							)}
							keyed={(effect) => effect.id}
						>
							{(effect) => (
								<div {...stylex.attrs(styles.historyHeader)}>
									<div {...stylex.attrs(styles.historyIdentity)}>
										<strong>{effect().intent.kind}</strong>
										<span {...stylex.attrs(styles.muted)}>
											{effect().intent.target} · Pending review · Not sent
										</span>
									</div>
									<Button
										size="sm"
										variant="ghost"
										onClick={() =>
											inspect(run().directory, `output/${effect().artifact}`)
										}
									>
										View intent
									</Button>
								</div>
							)}
						</For>
						<details {...stylex.attrs(styles.historyDetails)}>
							<summary {...stylex.attrs(styles.historyDetailsLabel)}>
								Run details
							</summary>
							<div {...stylex.attrs(styles.historyDetailsBody)}>
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
													{usage().cachedInputTokens?.toLocaleString()} cached
													input
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
								</Show>{" "}
								<div {...stylex.attrs(styles.row)}>
									{[
										"failed",
										"cancelled",
										"interrupted",
										"waiting_input",
									].includes(run().status) ? (
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
										onClick={() =>
											void inspect(run().directory, "inputs/run.json")
										}
									>
										Captured inputs
									</Button>
									<Button
										size="sm"
										onClick={() =>
											void inspect(
												run().directory,
												(
													run().snapshot as {
														execution?: { kind?: string };
													} | null
												)?.execution?.kind === "agent"
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
								<p {...stylex.attrs(styles.muted)}>{run().directory}</p>
							</div>
						</details>
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
