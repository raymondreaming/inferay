import * as stylex from "@stylexjs/stylex";
import { createSignal, onSettled } from "solid-js";
import type { EffectiveAgentContext } from "../../../../../build/presentation/contracts/EffectiveAgentContext.ts";
import { queryClient } from "../../../../shared/lib/dom.tsx";
import { fetchJson, postJson } from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { styles } from "./styles.ts";
export function GlobalAgentInstructionsSection(_props: {
	contained?: boolean;
}) {
	const [instructions, setInstructions] = createSignal("");
	const [savedInstructions, setSavedInstructions] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(true);
	const [isSaving, setIsSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	onSettled(() => {
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
	});
	const handleSave = async () => {
		const _instructionsValue = instructions();
		setIsSaving(true);
		setError("");
		try {
			await postJson(
				"/api/agent-context",
				{
					scope: "global",
					instructions: _instructionsValue,
					mode: "inherit",
					paneId: "global-settings",
				},
				{
					method: "PUT",
				},
			);
			setSavedInstructions(_instructionsValue);
			await queryClient.invalidateQueries({ queryKey: ["agent-context"] });
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
			{...stylex.attrs(
				styles.section,
				(_props.contained === undefined ? false : _props.contained) &&
					styles.sectionContained,
			)}
		>
			<div {...stylex.attrs(styles.agentInstructionsHeading)}>
				<div>
					<h4 {...stylex.attrs(styles.sectionHeading)}>
						Global agent instructions
					</h4>
					<p {...stylex.attrs(styles.sectionDescription)}>
						Your default AGENTS.md. Every new chat inherits these instructions.
					</p>
				</div>
			</div>
			<textarea
				value={instructions()}
				onInput={(event) => {
					setInstructions(event.currentTarget.value);
				}}
				disabled={isLoading()}
				placeholder="How should agents work with you?"
				{...stylex.attrs(styles.agentInstructionsEditor)}
			/>
			<div {...stylex.attrs(styles.agentInstructionsActions)}>
				<Button
					variant="secondary"
					size="sm"
					liquid={false}
					disabled={
						isLoading() || isSaving() || instructions() === savedInstructions()
					}
					onClick={() => void handleSave()}
				>
					{isSaving() ? "Saving…" : "Save"}
				</Button>
			</div>
			{error() ? (
				<p {...stylex.attrs(styles.backgroundError)}>{error()}</p>
			) : null}
		</div>
	);
}
