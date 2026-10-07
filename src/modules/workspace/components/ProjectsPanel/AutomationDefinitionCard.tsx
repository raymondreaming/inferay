import type { AutomationDefinition, ProjectFileCommand } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { useBackgroundQuery } from "@shared/hooks/useQueryResource.tsx";
import { queryClient } from "@shared/lib/dom.tsx";
import { getAgentDefinition } from "@shared/lib/native.tsx";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import {
	saveProjectCommand,
	selectProject,
	showProjectView,
} from "../../hooks/useProjects.tsx";
import { automationScheduleLabel } from "../../model/automationSchedule.ts";
import { loadProjects } from "../../services/projectsApi.ts";

export function AutomationDefinitionCard(props: {
	command: Extract<ProjectFileCommand, { type: "saveDefinition" }>;
	onResult?: (message: string) => void;
}) {
	// The native transcript model only exposes validated automation definitions.
	const definition = createMemo(
		() => JSON.parse(props.command.content) as AutomationDefinition,
	);
	const agent = createMemo(() => {
		const execution = definition().execution;
		return execution.kind === "agent" ? execution : undefined;
	});
	const modelLabel = createMemo(() => {
		const execution = agent();
		if (!execution) return "Local tool";
		const provider = getAgentDefinition(
			execution.provider === "claude" ? "claude" : "codex",
		);
		const id = execution.model || provider.defaultModel;
		const model = provider.models.find((model) => model.id === id);
		return [
			provider.kind === "claude" ? "Claude" : "Codex",
			model?.shortLabel ?? model?.label ?? id,
			execution.reasoningLevel,
		]
			.filter(Boolean)
			.join(" · ");
	});
	const [saved, setSaved] = createSignal(false);
	const [declined, setDeclined] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const catalog = useBackgroundQuery(
		() => ({
			queryKey: ["automation-proposal-project", props.command.projectId],
			queryFn: () => loadProjects(props.command.projectId),
		}),
		() => queryClient,
	);
	const existing = () =>
		catalog.data?.automations.find(
			(job) => job.file.sourcePath === props.command.path,
		);
	const changed = () =>
		(existing()?.file.sourceHash ?? null) !== props.command.expectedHash;
	const open = async () => {
		try {
			await selectProject(props.command.projectId);
			showProjectView("automations");
		} catch (error) {
			setError(String(error));
		}
	};
	return (
		<section
			aria-label="Automation proposal"
			{...stylex.attrs(surfaceStyles.panel, cardStyles.card)}
		>
			<div {...stylex.attrs(cardStyles.header)}>
				<div {...stylex.attrs(cardStyles.heading)}>
					<strong {...stylex.attrs(cardStyles.title)}>
						{definition().name}
					</strong>
					<p {...stylex.attrs(cardStyles.status)}>
						{saved()
							? "Saved · Schedule off"
							: declined()
								? "Declined"
								: changed()
									? "Project definition changed · Review the current automation"
									: "Automation proposal · Not saved"}
					</p>
				</div>
			</div>
			<div {...stylex.attrs(cardStyles.metadata)}>
				<span>{automationScheduleLabel(definition())}</span>
				<span>{modelLabel()}</span>
			</div>
			{agent() && <CardInstructions text={agent()!.instructions} />}
			{(error() || catalog.error) && (
				<p role="alert" {...stylex.attrs(cardStyles.feedback)}>
					{error() || String(catalog.error)}
				</p>
			)}
			<div {...stylex.attrs(cardStyles.footer)}>
				{!saved() && !declined() && !changed() && (
					<>
						<Button
							size="sm"
							disabled={busy() || catalog.isPending || !!catalog.error}
							onClick={async () => {
								setBusy(true);
								setError("");
								try {
									await saveProjectCommand(props.command);
									setSaved(true);
									props.onResult?.(
										"Saved the automation “" +
											definition().name +
											"”. Its schedule is off; execution still requires review and approval.",
									);
									await catalog.refetch();
								} catch (error) {
									setError(String(error));
								} finally {
									setBusy(false);
								}
							}}
						>
							Accept &amp; save
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy()}
							onClick={() => {
								setDeclined(true);
								props.onResult?.(
									"Declined the proposed automation “" +
										definition().name +
										"”. Do not apply it.",
								);
							}}
						>
							Decline
						</Button>
					</>
				)}
				{(saved() || existing()) && (
					<Button size="sm" variant="ghost" onClick={open}>
						Open Automations
					</Button>
				)}
			</div>
		</section>
	);
}
