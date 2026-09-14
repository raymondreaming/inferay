import { project } from "@shared/lib/native.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { ChatMessage } from "../AgentChatView/types.ts";
import { DecoratedText } from "../ChatTokenDecorators/index.tsx";
import { styles } from "./styles.ts";

/** Renders user text and attached images without carrying other message roles. */
export function UserMessage(props: {
	message: ChatMessage;
	slashCommandNames: readonly string[];
}) {
	const presentation = createMemo(() =>
		project<{ content: string; imagePaths: string[] } | null>("userMessage", {
			message: props.message,
			commands: props.slashCommandNames,
		}),
	);
	return (
		<div {...stylex.attrs(styles.userRow)}>
			<div {...stylex.attrs(styles.userBubble)}>
				{presentation() && presentation()!.imagePaths.length > 0 && (
					<div {...stylex.attrs(styles.userImages)}>
						<For each={presentation()!.imagePaths} keyed={(row) => row}>
							{(imgPath, index) => (
								<span
									{...stylex.attrs(
										styles.userImageFrame,
										index() % 2 === 1 && styles.userImageFrameAlt,
									)}
								>
									<img
										loading="lazy"
										decoding="async"
										src={`/api/file?thumbnail=true&path=${encodeURIComponent(imgPath())}`}
										alt=""
										{...stylex.attrs(styles.userImage)}
									/>
								</span>
							)}
						</For>
					</div>
				)}
				{presentation() && presentation()!.content && (
					<p {...stylex.attrs(styles.userText)}>
						<DecoratedText
							text={presentation()!.content}
							slashCommandNames={props.slashCommandNames}
							pills
						/>
					</p>
				)}
			</div>
		</div>
	);
}
