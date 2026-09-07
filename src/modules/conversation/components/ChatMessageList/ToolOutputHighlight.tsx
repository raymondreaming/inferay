import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo } from "solid-js";
import type { ToolOutputSummary } from "../../../../../build/presentation/contracts/ToolOutputSummary.ts";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { styles } from "./styles.ts";
export function ToolOutputHighlight(_props: {
	content: string;
	showOutput?: boolean;
	render?: ChatMessage["render"];
}) {
	const summary = createMemo(() =>
		getToolOutputSummary(_props.content, _props.render?.summary),
	);
	const trailingOutput = createMemo(() =>
		(_props.showOutput === undefined ? true : _props.showOutput)
			? (_props.render?.trailingOutput ?? "")
			: "",
	);
	let highlight: unknown;
	createEffect(
		() => [summary()],
		() => {
			if (summary().type === "edit" || summary().type === "file-content") {
				highlight = (
					<>
						<span {...stylex.attrs(styles.toolMuted)}>
							{summary().fileName}
						</span>
						{"\n"}
						<span {...stylex.attrs(styles.toolAccent)}>{summary().value}</span>
					</>
				);
			} else if (summary().type === "command") {
				highlight = (
					<span {...stylex.attrs(styles.toolAccent)}>$ {summary().value}</span>
				);
			} else if (summary().type === "pattern") {
				highlight = (
					<span {...stylex.attrs(styles.toolAccent)}>/{summary().value}/</span>
				);
			} else if (summary().type === "accent") {
				highlight = (
					<span {...stylex.attrs(styles.toolAccent)}>{summary().value}</span>
				);
			} else if (summary().type === "url") {
				highlight = (
					<a
						href={summary().value}
						target="_blank"
						rel="noopener noreferrer"
						{...stylex.attrs(styles.toolLink)}
					>
						{summary().value}
					</a>
				);
			} else {
				highlight = summary().value;
			}
		},
	);
	return (
		<>
			{highlight}
			{trailingOutput() && (
				<>
					{"\n"}
					{trailingOutput()}
				</>
			)}
		</>
	);
}
export function getToolOutputSummary(
	content: string,
	nativeSummary?: ToolOutputSummary | null,
): ToolOutputSummary {
	return (
		nativeSummary ?? {
			type: "text",
			value: content,
		}
	);
}
