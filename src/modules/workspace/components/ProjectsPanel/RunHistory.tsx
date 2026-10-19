import type { ProjectEffectIntent } from "@contracts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
	projects,
	refreshProjects,
	saveProjectCommand,
	showProjectView,
	useProjectAction,
} from "../../hooks/useProjects.tsx";
import { loadCanonicalAgentState } from "../../hooks/useWorkspaceState.tsx";
import {
	effectPresentation,
	loadProjectHistory,
	openRunChat,
} from "../../services/projectsApi.ts";
import { EffectInbox } from "./EffectInbox.tsx";
import { EffectIntentDialog } from "./EffectIntentDialog.tsx";
import { RunFilePreview } from "./RunFilePreview.tsx";
import { styles } from "./styles.ts";

export function RunHistory(props: {
	automationId?: string;
	selectAutomation: (id: string) => void;
}) {
	const [reviewing, setReviewing] = createSignal<ProjectEffectIntent | null>(
		null,
	);
	const { busy: opening, error, run } = useProjectAction();
	const continueRun = (id: string) =>
		run(async () => {
			await openRunChat(id);
			await loadCanonicalAgentState();
			await refreshProjects();
			showProjectView("chat");
		});
	const [cursor, setCursor] = createSignal<{
		scope: string;
		before: string;
	} | null>(null);
	const scope = () =>
		JSON.stringify([projects.selectedId(), props.automationId]);
	const before = () =>
		cursor()?.scope === scope() ? cursor()?.before : undefined;
	const history = useBackgroundQuery(() => ({
		queryKey: ["project-history", projects.selectedId(), before() ?? ""],
		queryFn: () => loadProjectHistory(projects.selectedId(), before()),
		enabled: !!before(),
	}));
	const [preview, setPreview] = createSignal<{
		directory: string;
		path: string;
	} | null>(null);
	const catalog = () => (before() ? history.data : projects.catalog());
	const upcoming = createMemo(() =>
		(projects.catalog()?.automations ?? [])
			.filter(
				(automation) =>
					automation.enabled &&
					!automation.file.definition.archived &&
					automation.nextDueAt !== null &&
					(!props.automationId ||
						automation.file.definition.id === props.automationId),
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
	return (
		<>
			<Show when={reviewing()} keyed>
				{(effect) => (
					<EffectIntentDialog
						effect={effect}
						close={() => setReviewing(null)}
						changed={async () => {
							await queryClient.invalidateQueries({
								queryKey: ["project-history", projects.selectedId()],
							});
							await refreshProjects();
						}}
					/>
				)}
			</Show>
			<EffectInbox
				projectId={projects.selectedId()}
				automationId={props.automationId}
			/>
			<Show when={!before() && upcoming().length > 0}>
				<section
					aria-label="Upcoming automations"
					{...stylex.attrs(styles.historyUpcoming)}
				>
					<strong {...stylex.attrs(styles.sectionLabel)}>Up next</strong>
					<p {...stylex.attrs(styles.muted)}>Runs while Inferay is open</p>
					<For
						each={upcoming()}
						keyed={(automation) => automation.file.definition.id}
					>
						{(automation) => (
							<div {...stylex.attrs(styles.row)}>
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										props.selectAutomation(automation().file.definition.id)
									}
								>
									{automation().file.definition.name}
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
			<Show when={before() && history.error}>
				<p role="alert">Unable to load older runs.</p>
			</Show>
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
									{run().presentation.status}
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
								{run().presentation.active ? (
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
										{run().presentation.active
											? "Open progress in chat"
											: "Open in chat"}
									</Button>
								) : null}
							</div>
						</div>
						{run().error ? <p role="alert">{run().error}</p> : null}
						<Show when={run().presentation.summary}>
							{(summary) => (
								<p {...stylex.attrs(styles.taskSummary)}>{summary()}</p>
							)}
						</Show>

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
											{effect().intent.target} ·{" "}
											{effectPresentation(effect()).status}
										</span>
									</div>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setReviewing(effect())}
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
									{run().presentation.retry ? (
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
									<For each={run().presentation.logs} keyed={(log) => log[1]}>
										{(log) => (
											<Button
												size="sm"
												onClick={() => inspect(run().directory, log()[1])}
											>
												{log()[0]}
											</Button>
										)}
									</For>
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
				{before() ? (
					<Button size="sm" onClick={() => setCursor(null)}>
						Latest runs
					</Button>
				) : null}
				{catalog()?.hasMoreRuns ? (
					<Button
						size="sm"
						onClick={() =>
							setCursor({ scope: scope(), before: catalog()!.nextRunCursor! })
						}
					>
						Older runs
					</Button>
				) : null}
			</div>
		</>
	);
}
