import { AgentIcon } from "@agents/components/AgentIcon/index.tsx";
import type {
	ProjectAutomation,
	ProjectCatalog,
	ProjectCommand,
} from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { getAgentDefinition } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import {
	IconClock,
	IconFolder,
	IconGitBranch,
} from "@shared/ui/Icons/index.tsx";
import { Modal } from "@shared/ui/Modal/index.tsx";
import { Switch } from "@shared/ui/Switch/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createSignal, onSettled, Show } from "solid-js";
import { automationScheduleLabel } from "../../model/automationSchedule.ts";
import { changeProject, loadProjects } from "../../services/projectsApi.ts";
import { AutomationEditor } from "./AutomationEditor.tsx";

const localStyles = stylex.create({
	editor: {
		width: "min(900px, calc(100vw - 48px))",
		maxHeight: "80dvh",
		overflowY: "auto",
		padding: 24,
	},
});

type Proposal = Extract<ProjectCommand, { type: "saveAutomation" }>;
export function AutomationProposalCard(props: { command: Proposal }) {
	const [catalog, setCatalog] = createSignal<ProjectCatalog>();
	const [busy, setBusy] = createSignal(false);
	const [loaded, setLoaded] = createSignal(false);
	const [error, setError] = createSignal("");
	const [editing, setEditing] = createSignal(false);
	const [dismissed, setDismissed] = createSignal(false);
	const [notice, setNotice] = createSignal("");
	const current = () =>
		catalog()?.automations.find((a) => a.id === props.command.id);
	const accepted = () =>
		!!current() && current()!.revision > (props.command.expectedRevision ?? 0);
	const draft = (): ProjectAutomation => ({
		id: props.command.id!,
		projectId: props.command.projectId,
		name: props.command.name,
		execution: props.command.execution,
		intervalSeconds: props.command.intervalSeconds,
		calendar: props.command.calendar,
		overlapPolicy: props.command.overlapPolicy,
		revision: props.command.expectedRevision ?? 0,
		enabled: false,
		inputsChanged: false,
		nextDueAt: null,
		archived: false,
	});
	const shown = () => (accepted() ? current()! : draft());
	async function refresh() {
		setCatalog(await loadProjects(props.command.projectId));
		setLoaded(true);
	}
	onSettled(() => {
		void refresh().catch((e: unknown) => setError(String(e)));
	});
	async function act(command: ProjectCommand) {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await changeProject(command);
			await refresh();
			if (command.type === "runAutomation")
				setNotice("Run started. Results will appear in run history.");
		} catch (e) {
			setError(String(e));
			throw e;
		} finally {
			setBusy(false);
		}
	}
	const submit = (command: ProjectCommand) => {
		void act(command).catch(() => {});
	};
	return (
		<section
			aria-label="Automation proposal"
			{...stylex.attrs(surfaceStyles.panel, cardStyles.card)}
		>
			<div {...stylex.attrs(cardStyles.header)}>
				<div {...stylex.attrs(cardStyles.heading)}>
					<div {...stylex.attrs(cardStyles.title)}>{shown().name}</div>
					<p {...stylex.attrs(cardStyles.status)}>
						{accepted()
							? current()?.enabled
								? "Project automation · Schedule enabled"
								: current()?.inputsChanged
									? "Schedule off: inputs changed. Review and enable."
									: "Project automation · Saved, schedule off"
							: "Project automation proposal · Not saved"}
					</p>
				</div>
				<Show when={shown().intervalSeconds}>
					<Switch
						label="Enable automation"
						checked={!!current()?.enabled}
						disabled={busy() || !accepted() || current()?.archived}
						onChange={(enabled) =>
							submit({
								type: "enableAutomation",
								id: current()!.id,
								expectedRevision: current()!.revision,
								enabled,
							})
						}
					/>
				</Show>
			</div>
			<div {...stylex.attrs(cardStyles.metadata)}>
				<span {...stylex.attrs(cardStyles.item)}>
					<IconClock size={13} />
					{automationScheduleLabel(shown())}
				</span>
				{(() => {
					const execution = shown().execution;
					if (execution.kind !== "agent") return <span>Local tool</span>;
					const provider = getAgentDefinition(
						execution.provider === "claude" ? "claude" : "codex",
					);
					return (
						<>
							<span {...stylex.attrs(cardStyles.item)}>
								<AgentIcon kind={provider.kind} size={13} />
								{provider.label} ·{" "}
								{provider.models.find((m) => m.id === execution.model)?.label ??
									execution.model ??
									"Default model"}{" "}
								· {execution.reasoningLevel || "Default"}
							</span>
							<span {...stylex.attrs(cardStyles.item)}>
								{execution.workingDirectory.base === "external" ? (
									<IconGitBranch size={13} />
								) : (
									<IconFolder size={13} />
								)}
								<span
									title={execution.workingDirectory.path}
									{...stylex.attrs(cardStyles.scope)}
								>
									{execution.workingDirectory.base === "external"
										? execution.workingDirectory.path
												.split("/")
												.filter(Boolean)
												.at(-1)
										: "Project-wide"}
								</span>
							</span>
						</>
					);
				})()}
			</div>
			{(() => {
				const execution = shown().execution;
				return execution.kind === "agent" ? (
					<CardInstructions text={execution.instructions} />
				) : null;
			})()}

			<Show when={error()}>
				<p {...stylex.attrs(cardStyles.feedback)} role="alert">
					{error()}
				</p>
			</Show>
			<Show when={notice()}>
				<p {...stylex.attrs(cardStyles.feedback)} role="status">
					{notice()}
				</p>
			</Show>
			<Show when={!dismissed()} fallback={<p>Proposal dismissed.</p>}>
				<div {...stylex.attrs(cardStyles.footer)}>
					<Show when={!accepted()}>
						<Button
							size="sm"
							disabled={busy() || !loaded()}
							onClick={() => submit(props.command)}
						>
							Accept & save
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy()}
							onClick={() => setDismissed(true)}
						>
							Dismiss
						</Button>
					</Show>
					<Button
						size="sm"
						disabled={busy() || !loaded() || current()?.archived}
						onClick={() => setEditing(true)}
					>
						Edit
					</Button>
					<Show when={accepted() && !current()?.archived}>
						<Button
							size="sm"
							disabled={busy()}
							onClick={() =>
								submit({
									type: "runAutomation",
									id: current()!.id,
									requestId: crypto.randomUUID(),
								})
							}
						>
							Run now
						</Button>
					</Show>
				</div>
			</Show>
			<Show when={editing()}>
				<Modal
					label="Edit automation"
					onClose={() => {
						if (!busy()) setEditing(false);
					}}
					closeDisabled={busy()}
				>
					<div {...stylex.attrs(localStyles.editor)}>
						<AutomationEditor
							projectId={props.command.projectId}
							automation={shown()}
							resources={catalog()?.resources ?? []}
							busy={busy()}
							close={() => setEditing(false)}
							save={async (command) => {
								if (command.type !== "saveAutomation") return;
								await act({
									...command,
									id: props.command.id,
									expectedRevision: accepted()
										? current()!.revision
										: props.command.expectedRevision,
								});
							}}
						/>
					</div>
				</Modal>
			</Show>
		</section>
	);
}
