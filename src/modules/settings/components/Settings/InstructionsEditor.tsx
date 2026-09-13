import type { EffectiveAgentContext } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import {
	action,
	createMemo,
	createOptimistic,
	createSignal,
	onCleanup,
} from "solid-js";
import { queryClient } from "../../../../shared/lib/dom.tsx";
import { fetchJson, postJson } from "../../../../shared/lib/native.tsx";
import { Button } from "../../../../shared/ui/Button/index.tsx";
import { styles } from "./styles.ts";

export function InstructionsEditor() {
	let disposed = false;
	let saving = false;
	onCleanup(() => {
		disposed = true;
	});
	const loaded = createMemo(async () => {
		const controller = new AbortController();
		onCleanup(() => controller.abort());
		const context = await fetchJson<EffectiveAgentContext>(
			"/api/agent-context?paneId=global-settings",
			{ signal: controller.signal },
		);
		return context.global.instructions;
	});
	// Saving changes the baseline without replacing edits typed during the request.
	const [instructions, setInstructions] = createSignal(() => loaded());
	const [savedInstructions, setSavedInstructions] = createSignal(() =>
		loaded(),
	);
	const [isSaving, setIsSaving] = createOptimistic(false);
	const [error, setError] = createSignal("");
	const save = action(function* (value: string) {
		setIsSaving(true);
		yield postJson(
			"/api/agent-context",
			{
				scope: "global",
				instructions: value,
				mode: "inherit",
				paneId: "global-settings",
			},
			{ method: "PUT" },
		);
		if (!disposed) setSavedInstructions(value);
		yield queryClient.invalidateQueries({ queryKey: ["agent-context"] });
	});
	const handleSave = () => {
		// The synchronous guard covers two clicks before Solid commits the UI state.
		if (disposed || saving) return;
		const value = instructions();
		if (value === savedInstructions()) return;
		saving = true;
		setError("");
		void save(value)
			.catch((cause) => {
				if (!disposed)
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to save agent instructions",
					);
			})
			.finally(() => {
				saving = false;
			});
	};
	return (
		<>
			<textarea
				value={instructions()}
				onInput={(event) => setInstructions(event.currentTarget.value)}
				placeholder="How should agents work with you?"
				{...stylex.attrs(styles.instructionsEditor)}
			/>
			<div {...stylex.attrs(styles.instructionsActions)}>
				{error() ? (
					<p role="alert" {...stylex.attrs(styles.instructionsError)}>
						{error()}
					</p>
				) : null}
				<Button
					variant="secondary"
					size="sm"
					disabled={isSaving() || instructions() === savedInstructions()}
					onClick={handleSave}
				>
					{isSaving() ? "Saving…" : "Save"}
				</Button>
			</div>
		</>
	);
}
