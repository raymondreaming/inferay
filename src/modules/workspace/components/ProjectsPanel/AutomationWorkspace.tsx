import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type { ProjectAutomation, ProjectCommand } from "@contracts";
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
import { color, font } from "../../../../design-system/styles.stylex.ts";
import { projects, saveProjectCommand } from "../../hooks/useProjects.tsx";
import { automationScheduleLabel } from "../../model/automationSchedule.ts";
import { automationStarters as starters } from "../../model/automationStarters.ts";
import { AutomationEditor } from "./AutomationEditor.tsx";
import { RunHistory } from "./RunHistory.tsx";
import { styles } from "./styles.ts";

const listStyles = stylex.create({
	scrollList: {
		flex: 1,
		minHeight: 0,
		overflowY: "auto",
		display: "flex",
		flexDirection: "column",
		gap: 12,
	},
	history: {
		borderWidth: 0,
		backgroundColor: "transparent",
		color: color.textMuted,
		fontSize: font.size_3,
		fontWeight: 400,
		textAlign: "left",
		cursor: "pointer",
		alignSelf: "flex-start",
		marginInline: 18,
		marginBottom: 16,
		flexShrink: 0,
		padding: 0,
	},
	row: {
		display: "flex",
		alignItems: "flex-start",
		gap: 8,
		padding: 10,
		borderRadius: 8,
		marginInline: 8,
	},
	button: {
		flex: 1,
		minWidth: 0,
		display: "flex",
		flexDirection: "column",
		alignItems: "stretch",
		gap: 5,
		padding: 0,
		border: 0,
		backgroundColor: "transparent",
		color: color.textMain,
		textAlign: "left",
		cursor: "pointer",
	},
	meta: {
		display: "flex",
		alignItems: "center",
		gap: 5,
		fontSize: 11,
		color: color.textMuted,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	name: { fontSize: 13, fontWeight: 600 },
});
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
	async function act(command: ProjectCommand) {
		try {
			await saveProjectCommand(command);
		} catch {
			/* Shared error shown below. */
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
					{automations()
						.filter((a) =>
							a.name.toLowerCase().includes(search().toLowerCase()),
						)
						.map((a) => (
							<div
								{...stylex.attrs(
									listStyles.row,
									screen() === "detail" &&
										current()?.id === a.id &&
										styles.selectedTab,
								)}
							>
								<button
									type="button"
									aria-pressed={ariaValue(
										screen() === "detail" && current()?.id === a.id,
									)}
									onClick={() => {
										setSelected(a.id);
										setScreen("detail");
									}}
									{...stylex.attrs(listStyles.button)}
								>
									<span {...stylex.attrs(listStyles.meta)}>
										{automationScheduleLabel(a)}
									</span>
									<strong {...stylex.attrs(listStyles.name)}>{a.name}</strong>
									{(() => {
										const execution = a.execution;
										if (execution.kind !== "agent")
											return (
												<span {...stylex.attrs(listStyles.meta)}>
													Local tool
												</span>
											);
										const provider = getAgentDefinition(
											execution.provider === "claude" ? "claude" : "codex",
										);
										const modelId = execution.model || provider.defaultModel;
										const model = provider.models.find((m) => m.id === modelId);
										return (
											<span {...stylex.attrs(listStyles.meta)}>
												{execution.workingDirectory.base === "external" ? (
													<IconGitBranch size={12} />
												) : (
													<IconFolder size={12} />
												)}
												{execution.workingDirectory.base === "external"
													? execution.workingDirectory.path
															.split("/")
															.filter(Boolean)
															.at(-1)
													: "Project-wide"}
												<AgentIcon kind={provider.kind} size={12} />
												{model?.shortLabel ?? model?.label ?? modelId}
											</span>
										);
									})()}
								</button>
								<Switch
									label={`Enable ${a.name}`}
									checked={a.enabled}
									disabled={projects.busy() || !a.intervalSeconds}
									onChange={(enabled) =>
										void act({
											type: "enableAutomation",
											id: a.id,
											expectedRevision: a.revision,
											enabled,
										})
									}
								/>
							</div>
						))}
					{!automations().length ? (
						<p {...stylex.attrs(styles.muted)}>
							Your automations will appear here.
						</p>
					) : null}
				</div>
				<button
					type="button"
					aria-pressed={ariaValue(screen() === "history")}
					onClick={() => setScreen("history")}
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
						<RunHistory automationId={selected() ?? undefined} />
					</>
				) : screen() === "starters" || !current() ? (
					<>
						<h2 {...stylex.attrs(styles.title)}>New automation</h2>
						<p {...stylex.attrs(styles.muted)}>
							Pick a starting point, or write your own task.
						</p>
						<div {...stylex.attrs(styles.starterGrid)}>
							{starters.map((seed) => (
								<button
									type="button"
									onClick={() => begin(undefined, seed)}
									{...stylex.attrs(styles.starterCard)}
								>
									<strong>{seed.name}</strong>
									<p {...stylex.attrs(styles.muted)}>{seed.description}</p>
									<span {...stylex.attrs(styles.muted)}>
										{seed.intervalSeconds === 86400
											? "Every day"
											: seed.intervalSeconds
												? "Every week"
												: "Your schedule"}
									</span>
								</button>
							))}
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
								<AutomationEditor
									persistent
									onDelete={() => {
										setRemoveError("");
										setRemoving(a());
									}}
									projectId={a().projectId}
									automation={a()}
									resources={projects.catalog()?.resources ?? []}
									busy={projects.busy()}
									close={() => {}}
									save={async (command) => {
										await saveProjectCommand(command);
									}}
									onRun={() =>
										void act({
											type: "runAutomation",
											id: a().id,
											requestId: crypto.randomUUID(),
										}).then(() => setScreen("history"))
									}
									onEnabledChange={(enabled) =>
										void act({
											type: "enableAutomation",
											id: a().id,
											expectedRevision: a().revision,
											enabled,
										})
									}
								/>
							</>
						)}
					</For>
				)}
			</div>
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
									await saveProjectCommand({
										type: "archiveAutomation",
										id: automation.id,
										expectedRevision: automation.revision,
									});
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
