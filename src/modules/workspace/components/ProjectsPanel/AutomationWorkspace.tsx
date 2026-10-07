import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type { ProjectFileCommand } from "@contracts";
import { ariaValue } from "@shared/lib/dom.tsx";
import { getAgentDefinition } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { IconButton } from "@shared/ui/IconButton/index.tsx";
import {
	IconFolder,
	IconGitBranch,
	IconPlus,
	IconSearch,
} from "@shared/ui/Icons/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { Switch } from "@shared/ui/Switch/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";
import { projects, saveProjectCommand } from "../../hooks/useProjects.tsx";
import { automationScheduleLabel } from "../../model/automationSchedule.ts";
import { automationStarters as starters } from "../../model/automationStarters.ts";
import {
	editDefinition,
	type ProjectAutomation,
} from "../../model/projectFiles.ts";
import { AutomationEditor } from "./AutomationEditor.tsx";
import { RunHistory } from "./RunHistory.tsx";
import { automationListStyles as listStyles, styles } from "./styles.ts";

export function AutomationWorkspace() {
	const [removing, setRemoving] = createSignal<ProjectAutomation | null>(null);
	const [removeError, setRemoveError] = createSignal("");
	const [selected, setSelected] = createSignal<string | null>(null);
	const [screen, setScreen] = createSignal<
		"detail" | "starters" | "edit" | "history"
	>("detail");
	const [editing, setEditing] = createSignal<ProjectAutomation | undefined>();
	const [starter, setStarter] = createSignal<
		(typeof starters)[number] | undefined
	>();
	const [search, setSearch] = createSignal("");
	const automations = () =>
		projects.catalog()?.automations.filter((a) => !a.archived) ?? [];
	const current = () =>
		automations().find((a) => a.id === selected()) ?? automations()[0];
	async function act(command: ProjectFileCommand) {
		try {
			await saveProjectCommand(command);
			return true;
		} catch {
			/* Shared error shown below. */
			return false;
		}
	}
	const [approval, setApproval] = createSignal<{
		automation: ProjectAutomation;
		hash: string;
		run: boolean;
	} | null>(null);
	async function enable(
		automation: ProjectAutomation,
		enabled: boolean,
		run = false,
	) {
		if (!enabled) {
			await act({ type: "disableAutomation", id: automation.id });
			return;
		}
		try {
			const review = await saveProjectCommand({
				type: "reviewAutomation",
				id: automation.id,
			});
			if (!review.inputsHash)
				throw new Error("Review did not return an input hash");
			if (run && review.approved) {
				if (
					await act({
						type: "runAutomation",
						id: automation.id,
						requestId: crypto.randomUUID(),
					})
				)
					setScreen("history");
				return;
			}
			setApproval({ automation, hash: review.inputsHash, run });
		} catch {
			/* Shared mutation error is displayed. */
		}
	}
	function begin(a?: ProjectAutomation, seed?: (typeof starters)[number]) {
		setEditing(a);
		setStarter(seed);
		setScreen("edit");
	}
	return (
		<section
			aria-label="Automation workspace"
			{...stylex.attrs(styles.automationWorkspace)}
		>
			<aside
				aria-label="Automations list"
				{...stylex.attrs(styles.automationList)}
			>
				<div {...stylex.attrs(styles.automationSearch)}>
					<IconSearch size={16} />
					<input
						type="search"
						aria-label="Search Automations"
						placeholder="Search Automations"
						value={search()}
						onInput={(e) => setSearch(e.currentTarget.value)}
						{...stylex.attrs(styles.automationSearchInput)}
					/>
					<IconButton
						aria-label="New automation"
						title="New automation"
						onClick={() => setScreen("starters")}
					>
						<IconPlus size={16} />
					</IconButton>
				</div>
				<div {...stylex.attrs(listStyles.scrollList)}>
					<For
						each={
							projects
								.catalog()
								?.issues.filter(
									(issue) =>
										issue.sourcePath.includes("/automations/") &&
										!automations().some(
											(a) => a.file.sourcePath === issue.sourcePath,
										),
								) ?? []
						}
					>
						{(issue) => (
							<div role="alert" {...stylex.attrs(listStyles.row)}>
								<div {...stylex.attrs(listStyles.button)}>
									<strong>Needs repair</strong>
									<span>{issue.sourcePath}</span>
									<span>{issue.error}</span>
								</div>
							</div>
						)}
					</For>
					<For
						each={automations().filter((a) =>
							a.name.toLowerCase().includes(search().toLowerCase()),
						)}
						keyed={(item) => item.id}
					>
						{(a) => (
							<div
								{...stylex.attrs(
									listStyles.row,
									screen() === "detail" &&
										current()?.id === a().id &&
										styles.selectedTab,
								)}
							>
								<button
									type="button"
									aria-pressed={ariaValue(
										screen() === "detail" && current()?.id === a().id,
									)}
									onClick={() => {
										setSelected(a().id);
										setScreen("detail");
									}}
									{...stylex.attrs(listStyles.button)}
								>
									<span {...stylex.attrs(listStyles.meta)}>
										{a().file.error
											? "Needs repair"
											: automationScheduleLabel(a())}
									</span>
									<strong {...stylex.attrs(listStyles.name)}>{a().name}</strong>
									{(() => {
										const execution = a().execution;
										if (execution.kind !== "agent")
											return (
												<span {...stylex.attrs(listStyles.meta)}>
													Local tool
												</span>
											);
										const provider = getAgentDefinition(
											execution.provider === "claude" ? "claude" : "codex",
										);
										const target = execution.workingDirectory;
										const modelId = execution.model || provider.defaultModel;
										const model = provider.models.find((m) => m.id === modelId);
										return (
											<span {...stylex.attrs(listStyles.meta)}>
												{target.base === "repository" ? (
													<IconGitBranch size={12} />
												) : (
													<IconFolder size={12} />
												)}
												{target.base === "repository"
													? (projects
															.list()
															.find((p) => p.id === a().file.projectId)
															?.repositories.find(
																(repo) => repo.id === target.id,
															)?.name ?? "Repository")
													: "Project-wide"}
												<AgentIcon kind={provider.kind} size={12} />
												{model?.shortLabel ?? model?.label ?? modelId}
											</span>
										);
									})()}
								</button>
								<Switch
									label={`Enable ${a().name}`}
									checked={a().enabled}
									disabled={
										projects.busy() ||
										!!a().file.error ||
										a().trigger.kind === "manual"
									}
									onChange={(enabled) => void enable(a(), enabled)}
								/>
							</div>
						)}
					</For>
				</div>
				<button
					type="button"
					aria-pressed={ariaValue(screen() === "history")}
					onClick={() => {
						setSelected(null);
						setScreen("history");
					}}
					{...stylex.attrs(listStyles.history)}
				>
					History
				</button>
			</aside>
			<div {...stylex.attrs(styles.automationContent)}>
				{projects.error() && screen() !== "edit" ? (
					<p role="alert">{projects.error()}</p>
				) : null}
				{screen() === "edit" ? (
					<AutomationEditor
						projectId={projects.selectedId()}
						automation={editing()}
						seed={starter()}
						resources={projects.catalog()?.resources ?? []}
						save={async (command) => {
							const result = await saveProjectCommand(command);
							if (result.id) setSelected(result.id);
						}}
						close={() => setScreen("detail")}
						busy={projects.busy()}
					/>
				) : screen() === "history" ? (
					<>
						<div {...stylex.attrs(styles.row)}>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setScreen("detail")}
							>
								Settings
							</Button>
							<strong>History</strong>
						</div>
						<RunHistory
							automationId={selected() ?? undefined}
							selectAutomation={(id) => {
								setSelected(id);
								setScreen("detail");
							}}
						/>
					</>
				) : screen() === "starters" || !current() ? (
					<>
						<h2 {...stylex.attrs(styles.title)}>New automation</h2>
						<p {...stylex.attrs(styles.muted)}>
							Pick a starting point, or write your own task.
						</p>
						<div {...stylex.attrs(styles.starterGrid)}>
							<For each={starters} keyed={(item) => item.name}>
								{(seed) => (
									<button
										type="button"
										onClick={() => begin(undefined, seed())}
										{...stylex.attrs(styles.starterCard)}
									>
										<strong>{seed().name}</strong>
										<p {...stylex.attrs(styles.muted)}>{seed().description}</p>
										<span {...stylex.attrs(styles.muted)}>
											{seed().intervalSeconds === 86400
												? "Every day"
												: seed().intervalSeconds
													? "Every week"
													: "Your schedule"}
										</span>
									</button>
								)}
							</For>
						</div>
					</>
				) : (
					<For each={current() ? [current()!] : []} keyed={(a) => a.id}>
						{(a) => (
							<>
								<div {...stylex.attrs(styles.row)}>
									<Button size="sm" variant="ghost">
										Settings
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setScreen("history")}
									>
										History
									</Button>
								</div>
								<Show when={a().file.error}>
									<p role="alert">{a().file.error}</p>
								</Show>
								<AutomationEditor
									persistent
									onDelete={() => {
										setRemoveError("");
										setRemoving(a());
									}}
									projectId={a().file.projectId}
									automation={a()}
									resources={projects.catalog()?.resources ?? []}
									busy={projects.busy()}
									close={() => {}}
									save={async (command) => {
										await saveProjectCommand(command);
									}}
									onRun={() => void enable(a(), true, true)}
									onEnabledChange={(enabled) => void enable(a(), enabled)}
								/>
							</>
						)}
					</For>
				)}
			</div>
			<Show when={approval()} keyed>
				{(review) => (
					<Modal
						label={review.run ? "Run automation" : "Enable automation"}
						onClose={() => setApproval(null)}
					>
						<h3>
							{review.run ? "Run" : "Enable"} {review.automation.name}?
						</h3>
						<p>{automationScheduleLabel(review.automation)}</p>
						<p>
							The current plugin files, selected resources, and skills will be
							approved for this automation.
						</p>
						<Button
							onClick={async () => {
								const approved = await act({
									type: "approveAutomation",
									id: review.automation.id,
									expectedInputsHash: review.hash,
									enable: review.run ? review.automation.enabled : true,
								});
								if (!approved) return;
								if (review.run) {
									if (
										!(await act({
											type: "runAutomation",
											id: review.automation.id,
											requestId: crypto.randomUUID(),
										}))
									)
										return;
									setScreen("history");
								}
								setApproval(null);
							}}
						>
							{review.run ? "Approve & run" : "Approve & enable"}
						</Button>
					</Modal>
				)}
			</Show>

			<Show when={removing()}>
				<Modal
					label="Delete automation"
					onClose={() => {
						if (!projects.busy()) setRemoving(null);
					}}
					closeDisabled={projects.busy()}
				>
					<h3>Delete “{removing()?.name}”?</h3>
					<p>
						This archives the automation and stops future scheduled runs.
						History is kept; any run already in progress can finish.
					</p>
					{removeError() && <p role="alert">{removeError()}</p>}
					<div {...stylex.attrs(styles.row)}>
						<Button
							disabled={projects.busy()}
							onClick={() => setRemoving(null)}
						>
							Cancel
						</Button>
						<Button
							variant="danger"
							disabled={projects.busy()}
							onClick={async () => {
								const automation = removing();
								if (!automation) return;
								try {
									await saveProjectCommand(
										editDefinition(automation.file, {
											...automation.file.definition!,
											archived: true,
										}),
									);
									setRemoving(null);
									setSelected(null);
								} catch (error) {
									setRemoveError(String(error));
								}
							}}
						>
							Delete automation
						</Button>
					</div>
				</Modal>
			</Show>
		</section>
	);
}
