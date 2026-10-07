import { iconSize } from "@design-system/styles.stylex.ts";
import { ariaValue } from "@shared/lib/dom.tsx";
import { IconBookmark, IconCheck } from "@shared/ui/Icons/index.tsx";
import { memoryTitle, saveMemoryNote } from "@shared/services/memoryApi.ts";
import * as stylex from "@stylexjs/stylex";
import { createSignal } from "solid-js";
import { styles } from "./styles.ts";

/** Saves one message as a project memory note, linked back to this chat. */
export function MemoryButton(props: {
	paneId: string;
	messageId: string;
	content: string;
}) {
	const [state, setState] = createSignal<"idle" | "saving" | "saved">("idle");
	const [problem, setProblem] = createSignal("");
	const save = async () => {
		if (state() !== "idle") return;
		setState("saving");
		setProblem("");
		try {
			await saveMemoryNote(
				{ paneId: props.paneId },
				{
					title: memoryTitle(props.content),
					body: props.content,
					tags: [],
					source: `chat:${props.paneId}/message:${props.messageId}`,
					supersedes: null,
					expires: null,
				},
			);
			setState("saved");
		} catch (error) {
			setProblem(error instanceof Error ? error.message : "Could not save");
			setState("idle");
		}
	};
	const label = () =>
		state() === "saved"
			? "Saved to memory"
			: problem() || "Save this message to project memory";
	return (
		<button
			type="button"
			onClick={save}
			disabled={state() === "saving"}
			title={label()}
			aria-label={ariaValue(label())}
			{...stylex.attrs(
				styles.copyMessageButton,
				state() === "saved" && styles.copyMessageButtonCopied,
			)}
		>
			{state() === "saved" ? (
				<IconCheck size={iconSize.compact} />
			) : (
				<IconBookmark size={iconSize.compact} />
			)}
			<span>
				{state() === "saved"
					? "Saved"
					: state() === "saving"
						? "Saving"
						: problem()
							? "Not saved"
							: "Memory"}
			</span>
		</button>
	);
}
