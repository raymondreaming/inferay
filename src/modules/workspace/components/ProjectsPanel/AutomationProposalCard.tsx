import type { LegacyAutomationProposal } from "@contracts";
import { surfaceStyles } from "@design-system/styles.stylex.ts";
import { Button } from "@shared/ui/Button/index.tsx";
import { CardInstructions } from "@shared/ui/ChatActionCard/index.tsx";
import { cardStyles } from "@shared/ui/ChatActionCard/styles.ts";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import { selectProject, showProjectView } from "../../hooks/useProjects.tsx";

// Persisted chats can contain proposals from before plugin bundles. Their
// revision numbers cannot authorize edits to today's files.
export function AutomationProposalCard(props: {
	command: Extract<LegacyAutomationProposal, { type: "saveAutomation" }>;
}) {
	const [error, setError] = createSignal("");
	return (
		<section
			aria-label="Earlier automation proposal"
			{...stylex.attrs(surfaceStyles.panel, cardStyles.card)}
		>
			<div {...stylex.attrs(cardStyles.header)}>
				<strong {...stylex.attrs(cardStyles.title)}>
					{props.command.name}
				</strong>
			</div>
			<p {...stylex.attrs(cardStyles.status)}>
				Earlier proposal · Review the current automation before making changes
			</p>
			{props.command.execution.kind === "agent" && (
				<CardInstructions text={props.command.execution.instructions} />
			)}
			{error() && <p role="alert">{error()}</p>}
			<div {...stylex.attrs(cardStyles.footer)}>
				<Button
					size="sm"
					onClick={async () => {
						try {
							await selectProject(props.command.projectId);
							showProjectView("automations");
						} catch (error) {
							setError(String(error));
						}
					}}
				>
					Open Automations
				</Button>
			</div>
		</section>
	);
}
