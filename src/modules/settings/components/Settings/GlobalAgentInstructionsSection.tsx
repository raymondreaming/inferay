import * as stylex from "@octanejs/stylex";
import { useEffect, useState } from "octane";
import { fetchJson, postJson } from "../../../../adapters/backend/http.ts";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import type { EffectiveAgentContext } from "../../../skills/model/skill-library.ts";
import { styles } from "./styles.ts";

export function GlobalAgentInstructionsSection({
	contained = false,
}: {
	contained?: boolean;
}) {
	const [instructions, setInstructions] = useState("");
	const [savedInstructions, setSavedInstructions] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		void fetchJson<EffectiveAgentContext>(
			"/api/agent-context?paneId=global-settings",
		)
			.then((context) => {
				setInstructions(context.global.instructions);
				setSavedInstructions(context.global.instructions);
				setError("");
			})
			.catch((cause) => {
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to load agent instructions",
				);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, []);

	const handleSave = async () => {
		setIsSaving(true);
		setError("");
		try {
			await postJson(
				"/api/agent-context",
				{
					scope: "global",
					instructions,
					mode: "inherit",
					paneId: "global-settings",
				},
				{ method: "PUT" },
			);
			setSavedInstructions(instructions);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Unable to save agent instructions",
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div
			id="agent-instructions"
			{...stylex.props(styles.section, contained && styles.sectionContained)}
		>
			<div {...stylex.props(styles.agentInstructionsHeading)}>
				<div>
					<h4 {...stylex.props(styles.sectionHeading)}>
						Global agent instructions
					</h4>
					<p {...stylex.props(styles.sectionDescription)}>
						Your default AGENTS.md. Every new chat inherits these instructions.
					</p>
				</div>
			</div>
			<textarea
				value={instructions}
				onInput={(event) => {
					setInstructions(event.currentTarget.value);
				}}
				disabled={isLoading}
				placeholder="How should agents work with you?"
				{...stylex.props(styles.agentInstructionsEditor)}
			/>
			<div {...stylex.props(styles.agentInstructionsActions)}>
				<Button
					variant="secondary"
					size="sm"
					liquid={false}
					disabled={isLoading || isSaving || instructions === savedInstructions}
					onClick={() => void handleSave()}
				>
					{isSaving ? "Saving…" : "Save"}
				</Button>
			</div>
			{error ? <p {...stylex.props(styles.backgroundError)}>{error}</p> : null}
		</div>
	);
}
