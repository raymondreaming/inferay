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
import { useProjectProposal } from "../../hooks/useProjectProposal.tsx";
import { selectProject, showProjectView } from "../../hooks/useProjects.tsx";
import { automationScheduleLabel } from "../../model/automationSchedule.ts";
import { loadProjects } from "../../services/projectsApi.ts";

export function AutomationDefinitionCard(props: {
	command: Extract<ProjectFileCommand, { type: "saveDefinition" }>;
	messageId: string;
	onResult?: (message: string) => void;
}) {
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
	const proposal = useProjectProposal(() => ({
		messageId: props.messageId,
		command: props.command,
	}));
	const saved = () => proposal.view()?.status === "saved";
	const declined = () => proposal.view()?.status === "declined";
	const busy = () => proposal.busy() || proposal.loading();
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
							? "Saved"
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
			{(error() || proposal.error() || catalog.error) && (
				<p role="alert" {...stylex.attrs(cardStyles.feedback)}>
					{error() || proposal.error() || String(catalog.error)}
				</p>
			)}
			<div {...stylex.attrs(cardStyles.footer)}>
				{!saved() && !declined() && (
					<>
						<Button
							size="sm"
							disabled={
								busy() || catalog.isPending || !!catalog.error || changed()
							}
							onClick={async () => {
								const result = await proposal.decide("save");
								if (result?.status === "saved") {
									props.onResult?.(
										"Saved the automation “" +
											definition().name +
											"”. Execution approval is separate.",
									);
									await catalog.refetch();
								}
							}}
						>
							Accept &amp; save
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy()}
							onClick={async () => {
								const result = await proposal.decide("decline");
								if (result?.status === "declined")
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
