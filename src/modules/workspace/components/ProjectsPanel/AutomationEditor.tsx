import type {
	ProjectAutomation,
	ProjectCommand,
	ProjectResource,
} from "@contracts";
import { ComposerControls } from "@conversation/components/ChatComposer/ComposerControls.tsx";
import { ProviderConfigMenu } from "@conversation/components/ChatComposer/ProviderConfigMenu.tsx";
import { useAgentConfiguration } from "@conversation/components/ChatComposer/useAgentConfiguration.tsx";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { ariaValue, queryClient } from "@shared/lib/dom.tsx";
import { getAgentDefinition } from "@shared/lib/native.tsx";
import { BorderBeamOverlay } from "@shared/ui/BorderBeamOverlay/index.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { IconFolder, IconGitBranch } from "@shared/ui/Icons/index.tsx";
import { SettingsRow } from "@shared/ui/SettingsSurface/index.tsx";
import { Switch } from "@shared/ui/Switch/index.tsx";
import { skillsQuery } from "@skills/services/skillsApi.ts";
import * as stylex from "@stylexjs/stylex";
import { createSignal, Show } from "solid-js";
import { useAutomationAutosave } from "../../hooks/useAutomationAutosave.tsx";
import { projects } from "../../hooks/useProjects.tsx";
import { AutomationTrigger } from "./AutomationTrigger.tsx";
import { styles } from "./styles.ts";
export function AutomationEditor(props: {
	persistent?: boolean;
	onRun?: () => void;
	onDelete?: () => void;
	onEnabledChange?: (enabled: boolean) => void;
	projectId: string;
	seed?: { name: string; instructions: string; intervalSeconds: number | null };
	automation?: ProjectAutomation;
	resources: ProjectResource[];
	save: (command: ProjectCommand) => Promise<void>;
	close: () => void;
	busy: boolean;
}) {
	const [scheduleTime, setScheduleTime] = createSignal(
		props.automation?.calendar?.time ?? "09:00",
	);
	const [timezone, setTimezone] = createSignal(
		props.automation?.calendar?.timezone ??
			Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	const [weekday, setWeekday] = createSignal(
		String(props.automation?.calendar?.weekday ?? 0),
	);
	const [instructionsFocused, setInstructionsFocused] = createSignal(false);
	const library = useBackgroundQuery(skillsQuery, () => queryClient);
	const initial = props.automation?.execution;
	const [name, setName] = createSignal(
		props.automation?.name ?? (props.seed?.instructions ? props.seed.name : ""),
	);
	const [kind, setKind] = createSignal(initial?.kind ?? "agent");
	const [toolId, setToolId] = createSignal(
		initial?.kind === "tool"
			? initial.toolId
			: (props.resources.find((r) => r.typeId === "inferay.tool")?.id ?? ""),
	);
	const [input, setInput] = createSignal(
		JSON.stringify(initial?.kind === "tool" ? initial.input : {}, null, 2),
	);
	const [instructions, setInstructions] = createSignal(
		initial?.kind === "agent"
			? initial.instructions
			: (props.seed?.instructions ?? ""),
	);
	const [provider, setProvider] = createSignal(
		initial?.kind === "agent" ? initial.provider : "codex",
	);
	const [model, setModel] = createSignal(
		initial?.kind === "agent"
			? (initial.model ??
					getAgentDefinition(initial.provider === "claude" ? "claude" : "codex")
						.defaultModel)
			: getAgentDefinition("codex").defaultModel,
	);
	const [reasoning, setReasoning] = createSignal(
		initial?.kind === "agent" ? initial.reasoningLevel || "low" : "low",
	);
	const configuration = useAgentConfiguration(() => ({
		agentKind: provider() === "claude" ? "claude" : "codex",
		agentKindOptions: [
			{ id: "codex", label: "Codex" },
			{ id: "claude", label: "Claude" },
		],
		model: model(),
		reasoningLevel: reasoning(),
		onAgentKindChange: (kind) => {
			setProvider(kind);
			setModel(getAgentDefinition(kind).defaultModel);
			setReasoning("low");
		},
		onModelChange: setModel,
		onReasoningLevelChange: setReasoning,
	}));
	const [context, setContext] = createSignal(
		initial?.kind === "agent" ? initial.resourceIds.join(", ") : "",
	);
	const [skills, setSkills] = createSignal(
		initial?.kind === "agent" ? initial.skillIds.join(", ") : "",
	);
	const [cwd, setCwd] = createSignal(
		initial?.kind === "agent" && initial.workingDirectory.base === "external"
			? initial.workingDirectory.path
			: "",
	);
	const [seconds, setSeconds] = createSignal(
		String(
			props.automation?.intervalSeconds ?? props.seed?.intervalSeconds ?? "",
		),
	);
	const [overlap, setOverlap] = createSignal(
		props.automation?.overlapPolicy ?? "skip",
	);
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const [toolInputOpen, setToolInputOpen] = createSignal(
		initial?.kind === "tool" && JSON.stringify(initial.input) !== "{}",
	);
	const presets = [
		{ value: "", label: "Manually" },
		{ value: "3600", label: "Hourly" },
		{ value: "86400", label: "Daily" },
		{ value: "604800", label: "Weekly" },
	];
	const [customSchedule, setCustomSchedule] = createSignal(
		!!seconds() && !presets.some((p) => p.value === seconds()),
	);
	const [error, setError] = createSignal("");
	const draft = (): ProjectCommand => ({
		type: "saveAutomation",
		id: props.automation?.id ?? null,
		expectedRevision: props.automation?.revision ?? null,
		projectId: props.projectId,
		name: name(),
		intervalSeconds: seconds() ? Number(seconds()) : null,
		calendar:
			!customSchedule() && ["86400", "604800"].includes(seconds())
				? {
						time: scheduleTime(),
						timezone: timezone(),
						weekday: seconds() === "604800" ? Number(weekday()) : null,
					}
				: null,
		overlapPolicy: overlap(),
		execution:
			kind() === "tool"
				? { kind: "tool", toolId: toolId(), input: JSON.parse(input()) }
				: {
						kind: "agent",
						instructions: instructions(),
						provider: provider(),
						model: model() || null,
						reasoningLevel: reasoning() || null,
						resourceIds: context()
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
						skillIds: skills()
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
						timeoutSeconds:
							initial?.kind === "agent" ? initial.timeoutSeconds : 300,
						workingDirectory: cwd()
							? { base: "external", path: cwd() }
							: initial?.kind === "agent" &&
									initial.workingDirectory.base === "project"
								? initial.workingDirectory
								: { base: "project", path: "." },
					},
	});
	const { flush, savingEdits } = useAutomationAutosave(
		() => !!props.persistent,
		draft,
		(command) => props.save(command),
		setError,
	);
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (props.persistent) {
			await flush();
			return;
		}
		setError("");
		try {
			await props.save(draft());
			props.close();
		} catch (error) {
			setError(String(error));
		}
	}

	return (
		<form
			onSubmit={(e) => void submit(e)}
			{...stylex.attrs(styles.automationForm)}
		>
			{props.automation?.inputsChanged && !props.automation.enabled && (
				<p role="status" {...stylex.attrs(styles.muted)}>
					Schedule off: inputs changed. Review and enable.
				</p>
			)}
			<header {...stylex.attrs(styles.editorTop)}>
				<input
					aria-label="Name"
					required
					placeholder="Untitled"
					value={name()}
					onInput={(e) => setName(e.currentTarget.value)}
					{...stylex.attrs(styles.editorTitle)}
				/>
				<div {...stylex.attrs(styles.row)}>
					<Show when={!props.persistent}>
						<Button size="sm" onClick={props.close}>
							Cancel
						</Button>
					</Show>
					<Show when={props.onDelete}>
						<Button
							size="sm"
							variant="ghost"
							disabled={props.busy || savingEdits()}
							onClick={props.onDelete}
						>
							Delete…
						</Button>
					</Show>
					<Show when={savingEdits()}>
						<span role="status">Saving…</span>
					</Show>
					<Show when={props.onRun}>
						<Button
							size="sm"
							disabled={props.busy}
							onClick={async () => {
								if (await flush()) props.onRun?.();
							}}
						>
							Run now
						</Button>
					</Show>
					<Show when={!props.persistent}>
						<Button
							size="sm"
							type="submit"
							variant="primary"
							disabled={
								props.busy ||
								!name().trim() ||
								(kind() === "tool" ? !toolId() : !instructions().trim())
							}
						>
							{props.automation ? "Save changes" : "Create"}
						</Button>
					</Show>
				</div>
			</header>
			<div {...stylex.attrs(styles.editorMeta)}>
				<Show when={props.onEnabledChange}>
					<Switch
						label="Active automation"
						checked={!!props.automation?.enabled}
						disabled={props.busy || !props.automation?.intervalSeconds}
						onChange={async (enabled) => {
							if (await flush()) props.onEnabledChange?.(enabled);
						}}
					/>
					<span>Active</span>
				</Show>
				<span {...stylex.attrs(styles.muted)}>Project automation</span>
				<DropdownButton
					value={kind()}
					options={[
						{ id: "agent", label: "Agent task" },
						{ id: "tool", label: "Local tool" },
					]}
					onChange={(value) => setKind(value as "agent" | "tool")}
				/>
				{kind() === "agent" ? (
					<DropdownButton
						value={cwd() || "project"}
						placeholder="Target"
						label="Automation target"
						icon={
							cwd() ? <IconGitBranch size={14} /> : <IconFolder size={14} />
						}
						options={[
							{
								id: "project",
								label: "Project-wide",
								iconComponent: () => <IconFolder size={14} />,
							},
							...[
								...new Set([
									...(projects.catalog()?.repositoryPaths ?? []),
									...(cwd() ? [cwd()] : []),
								]),
							].map((path) => ({
								id: path,
								label: path.split("/").at(-1) || path,
								iconComponent: () => <IconGitBranch size={14} />,
							})),
						]}
						onChange={(id) => setCwd(id === "project" ? "" : id)}
					/>
				) : (
					<span {...stylex.attrs(styles.muted)}>
						Uses the tool’s working directory
					</span>
				)}
			</div>
			<AutomationTrigger
				seconds={seconds}
				customSchedule={customSchedule}
				scheduleTime={scheduleTime}
				timezone={timezone}
				weekday={weekday}
				setSeconds={setSeconds}
				setCustomSchedule={setCustomSchedule}
				setScheduleTime={setScheduleTime}
				setTimezone={setTimezone}
				setWeekday={setWeekday}
			/>
			{kind() === "tool" ? (
				<>
					<div>
						<span>Tool</span>
						<DropdownButton
							value={toolId() || null}
							placeholder="Select a tool"
							emptyLabel="No tools in this project"
							options={props.resources
								.filter((r) => r.typeId === "inferay.tool" && !r.archived)
								.map((r) => ({ id: r.id, label: r.name }))}
							onChange={setToolId}
						/>
					</div>
					{props.resources.some(
						(r) => r.typeId === "inferay.tool" && !r.archived,
					) ? (
						<>
							<Button
								size="sm"
								onClick={() => setToolInputOpen(!toolInputOpen())}
							>
								{toolInputOpen() ? "Hide tool input" : "Configure tool input"}
							</Button>
							{toolInputOpen() ? (
								<label>
									Tool input (JSON)
									<textarea
										value={input()}
										onInput={(e) => setInput(e.currentTarget.value)}
										{...stylex.attrs(styles.code, styles.compactCode)}
									/>
								</label>
							) : null}
						</>
					) : (
						<p {...stylex.attrs(styles.muted)}>
							Add a tool from the Tools page to use it here.
						</p>
					)}
				</>
			) : (
				<>
					<section {...stylex.attrs(styles.editorSection)}>
						<span {...stylex.attrs(styles.editorLabel)}>Instructions</span>
						<div
							{...stylex.attrs(surfaceStyles.panel, styles.instructionComposer)}
						>
							<BorderBeamOverlay active={instructionsFocused() || props.busy} />
							<textarea
								aria-label="Instructions"
								onFocus={() => setInstructionsFocused(true)}
								onBlur={() => setInstructionsFocused(false)}
								required
								placeholder="Tell the agent what to do when this automation runs…"
								value={instructions()}
								onInput={(e) => setInstructions(e.currentTarget.value)}
								{...stylex.attrs(styles.instructionInput)}
							/>
							<div {...stylex.attrs(styles.composerControls)}>
								<ComposerControls {...configuration} />
								<Show when={configuration.activeControl}>
									{(control) => (
										<ProviderConfigMenu
											{...configuration}
											activeControl={control()}
										/>
									)}
								</Show>
							</div>
						</div>
					</section>
					<section {...stylex.attrs(styles.editorSection)}>
						<span {...stylex.attrs(styles.editorLabel)}>
							Context & execution
						</span>
						<SettingsRow
							label="Project context"
							description="Instructions, resources, and skills"
						>
							<Button
								size="sm"
								aria-expanded={ariaValue(settingsOpen())}
								onClick={() => setSettingsOpen(!settingsOpen())}
							>
								{settingsOpen() ? "Done" : "Configure"}
							</Button>
						</SettingsRow>
						<SettingsRow
							label="Overlapping runs"
							description="When the previous run is still active"
						>
							<DropdownButton
								value={overlap()}
								options={[
									{ id: "skip", label: "Skip" },
									{ id: "queue_one", label: "Queue one" },
								]}
								onChange={setOverlap}
							/>
						</SettingsRow>
					</section>
					{settingsOpen() ? (
						<section
							aria-label="Agent settings"
							{...stylex.attrs(styles.automationSettings)}
						>
							<fieldset {...stylex.attrs(styles.form)}>
								<legend>Project context</legend>
								{props.resources
									.filter((r) => !r.archived)
									.map((r) => (
										<label {...stylex.attrs(styles.row)}>
											<input
												type="checkbox"
												checked={context()
													.split(",")
													.map((v) => v.trim())
													.includes(r.id)}
												onChange={(e) => {
													const ids = context()
														.split(",")
														.map((v) => v.trim())
														.filter(Boolean)
														.filter((id) => id !== r.id);
													if (e.currentTarget.checked) ids.push(r.id);
													setContext(ids.join(", "));
												}}
											/>
											{r.name} · {r.typeId}
										</label>
									))}
							</fieldset>
							<fieldset {...stylex.attrs(styles.form)}>
								<legend>Skills</legend>
								{library.data?.map((skill) => (
									<label {...stylex.attrs(styles.row)}>
										<input
											type="checkbox"
											checked={skills()
												.split(",")
												.map((v) => v.trim())
												.includes(skill._id)}
											onChange={(e) => {
												const ids = skills()
													.split(",")
													.map((v) => v.trim())
													.filter(Boolean)
													.filter((id) => id !== skill._id);
												if (e.currentTarget.checked) ids.push(skill._id);
												setSkills(ids.join(", "));
											}}
										/>
										{skill.name}
									</label>
								))}
							</fieldset>
							<label>
								External working directory (blank uses project)
								<input
									value={cwd()}
									onInput={(e) => setCwd(e.currentTarget.value)}
									{...stylex.attrs(styles.input)}
								/>
							</label>{" "}
						</section>
					) : null}
				</>
			)}
			{error() ? <p role="alert">{error()}</p> : null}
		</form>
	);
}
