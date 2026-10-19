import type {
	AutomationDefinition,
	DefinitionExecution,
	ProjectFileCommand,
} from "@contracts";
import { ComposerControls } from "@conversation/components/ChatComposer/ComposerControls.tsx";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { ariaValue } from "@shared/lib/dom.tsx";
import { getAgentDefinition, project } from "@shared/lib/native.tsx";
import { BorderBeamOverlay } from "@shared/ui/BorderBeamOverlay/index.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { DropdownButton } from "@shared/ui/DropdownButton/index.tsx";
import { IconFolder, IconGitBranch } from "@shared/ui/Icons/index.tsx";
import { SettingsRow } from "@shared/ui/SettingsSurface/index.tsx";
import { Switch } from "@shared/ui/Switch/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, createStore, Show } from "solid-js";
import { useAutomationAutosave } from "../../hooks/useAutomationAutosave.tsx";
import { projects } from "../../hooks/useProjects.tsx";
import type { ProjectAutomation } from "../../model/projectFiles.ts";
import { AutomationContext } from "./AutomationContext.tsx";
import { AutomationTools } from "./AutomationTools.tsx";
import { AutomationTrigger } from "./AutomationTrigger.tsx";
import { styles } from "./styles.ts";

function RepositoryIcon() {
	return <IconGitBranch size={14} />;
}

export function AutomationEditor(props: {
	persistent?: boolean;
	onRun?: () => void;
	onDelete?: () => void;
	onEnabledChange?: (enabled: boolean) => void;
	projectId: string;
	seed?: { name: string; instructions: string; intervalSeconds: number | null };
	automation?: ProjectAutomation;
	save: (command: ProjectFileCommand) => Promise<void>;
	close: () => void;
	busy: boolean;
}) {
	const automationId =
		props.automation?.file.definition.id ?? crypto.randomUUID();
	const pluginPath =
		props.automation?.file.sourcePath.split("/").slice(0, 2).join("/") ??
		`automations/${automationId}`;
	const tools = () =>
		(projects.catalog()?.tools ?? []).filter((tool) =>
			tool.sourcePath.startsWith(`${pluginPath}/`),
		);
	const defaults = () =>
		project("newAutomation", {
			id: automationId,
			name: props.seed?.instructions ? props.seed.name : "",
			instructions: props.seed?.instructions ?? "",
			model: getAgentDefinition("codex").defaultModel,
			intervalSeconds: props.seed?.intervalSeconds ?? null,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});
	const [fields, setFields] = createStore(
		structuredClone(props.automation?.file.definition ?? defaults()),
		{ shallow: true },
	);
	const edit = (patch: Partial<AutomationDefinition>) =>
		setFields((draft) => {
			Object.assign(draft, patch);
		});
	const editExecution = (patch: Partial<DefinitionExecution>) =>
		edit({
			execution: { ...fields.execution, ...patch } as DefinitionExecution,
		});
	const agent = () =>
		fields.execution.kind === "agent" ? fields.execution : undefined;
	const tool = () =>
		fields.execution.kind === "tool" ? fields.execution : undefined;
	const cwd = () => {
		const directory = agent()?.workingDirectory;
		return directory?.base === "repository" ? directory.id : "";
	};
	let previousExecution: DefinitionExecution | undefined;
	const switchExecution = (kind: string) => {
		if (kind === fields.execution.kind) return;
		const next =
			previousExecution ??
			(kind === "agent"
				? defaults().execution
				: {
						kind: "tool" as const,
						tool: tools()[0]?.definition.id ?? "",
						input: {},
					});
		previousExecution = structuredClone(fields.execution);
		edit({ execution: next });
	};
	const [input, setInput] = createSignal(
		JSON.stringify(tool()?.input ?? {}, null, 2),
	);
	const [instructionsFocused, setInstructionsFocused] = createSignal(false);
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	const [toolInputOpen, setToolInputOpen] = createSignal(
		!!tool() && input() !== "{}",
	);
	const [error, setError] = createSignal("");
	const definition = (): AutomationDefinition => ({
		...fields,
		execution:
			fields.execution.kind === "tool"
				? { ...fields.execution, input: JSON.parse(input()) }
				: fields.execution,
	});
	const draft = (): ProjectFileCommand => ({
		type: "saveDefinition",
		projectId: props.projectId,
		path: props.automation?.file.sourcePath ?? `${pluginPath}/automation.json`,
		expectedHash: props.automation?.file.sourceHash ?? null,
		content: JSON.stringify(definition(), null, 2),
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
					value={fields.name}
					onInput={(e) => edit({ name: e.currentTarget.value })}
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
							disabled={props.busy || !!props.automation?.file.error}
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
								!fields.name.trim() ||
								(fields.execution.kind === "tool"
									? !tool()?.tool
									: !(agent()?.instructions ?? "").trim())
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
						disabled={
							props.busy ||
							!!props.automation?.file.error ||
							props.automation?.file.definition.trigger.kind === "manual"
						}
						onChange={async (enabled) => {
							if (await flush()) props.onEnabledChange?.(enabled);
						}}
					/>
					<span>Active</span>
				</Show>
				<span {...stylex.attrs(styles.muted)}>Project automation</span>
				<DropdownButton
					value={fields.execution.kind}
					options={[
						{ id: "agent", label: "Agent task" },
						{ id: "tool", label: "Local tool" },
					]}
					onChange={(value) => switchExecution(value)}
				/>
				{fields.execution.kind === "agent" ? (
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
							...(
								projects.list().find((p) => p.id === props.projectId)
									?.definition.repositories ?? []
							).map((repo) => ({
								id: repo.id,
								label: repo.name,
								iconComponent: RepositoryIcon,
							})),
						]}
						onChange={(id) =>
							editExecution({
								workingDirectory:
									id === "project"
										? { base: "project", path: "." }
										: { base: "repository", id },
								repositories:
									id === "project"
										? (agent()?.repositories ?? [])
										: [...new Set([...(agent()?.repositories ?? []), id])],
							})
						}
					/>
				) : (
					<span {...stylex.attrs(styles.muted)}>
						Uses the tool’s working directory
					</span>
				)}
			</div>
			<AutomationTrigger
				trigger={fields.trigger}
				onChange={(trigger) => edit({ trigger })}
			/>
			{fields.execution.kind === "tool" ? (
				<>
					<div>
						<span>Tool</span>
						<DropdownButton
							value={tool()?.tool || null}
							placeholder="Select a tool"
							emptyLabel="No tools in this project"
							options={tools().map((tool) => ({
								id: tool.definition.id,
								label: tool.definition.name,
							}))}
							onChange={(value) => editExecution({ tool: value })}
						/>
					</div>
					{tools().length > 0 ? (
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
								value={agent()?.instructions ?? ""}
								onInput={(e) =>
									editExecution({ instructions: e.currentTarget.value })
								}
								{...stylex.attrs(styles.instructionInput)}
							/>
							<div {...stylex.attrs(styles.composerControls)}>
								<ComposerControls
									agentKind={
										agent()?.provider === "claude" ? "claude" : "codex"
									}
									agentKindOptions={[
										{ id: "codex", label: "Codex" },
										{ id: "claude", label: "Claude" },
									]}
									model={
										agent()?.model ??
										getAgentDefinition(
											agent()?.provider === "claude" ? "claude" : "codex",
										).defaultModel
									}
									reasoningLevel={agent()?.reasoningLevel ?? "low"}
									onAgentKindChange={(kind) =>
										editExecution({
											provider: kind,
											model: getAgentDefinition(kind).defaultModel,
											reasoningLevel: "low",
										})
									}
									onModelChange={(value) => editExecution({ model: value })}
									onReasoningLevelChange={(value) =>
										editExecution({ reasoningLevel: value })
									}
								/>
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
								value={fields.overlap}
								options={[
									{ id: "skip", label: "Skip" },
									{ id: "queue_one", label: "Queue one" },
								]}
								onChange={(value) =>
									edit({
										overlap: value === "queue_one" ? "queue_one" : "skip",
									})
								}
							/>
						</SettingsRow>
					</section>
					{settingsOpen() ? (
						<section
							aria-label="Agent settings"
							{...stylex.attrs(styles.automationSettings)}
						>
							<AutomationContext
								context={agent()?.resources ?? []}
								onContextChange={(value) => editExecution({ resources: value })}
								ownerPath={pluginPath}
								value={agent()?.skills ?? []}
								onChange={(value) => editExecution({ skills: value })}
							/>
							<AutomationTools
								value={agent()?.tools ?? []}
								onChange={(value) => editExecution({ tools: value })}
							/>
						</section>
					) : null}
				</>
			)}
			{error() ? <p role="alert">{error()}</p> : null}
		</form>
	);
}
