import * as stylex from "@octanejs/stylex";
import type { ChatMessage } from "../../model/agent-chat-shared.ts";
import { getToolOutputSummary } from "../../model/agent-chat-shared.ts";
import { styles } from "./styles.ts";

export function ToolOutputHighlight({
	content,
	showOutput = true,
	render,
}: {
	content: string;
	showOutput?: boolean;
	render?: ChatMessage["render"];
}) {
	const summary = getToolOutputSummary(content, render?.summary);
	const trailingOutput = showOutput ? (render?.trailingOutput ?? "") : "";
	let highlight: unknown;
	if (summary.type === "edit" || summary.type === "file-content") {
		highlight = (
			<>
				<span {...stylex.props(styles.toolMuted)}>{summary.fileName}</span>
				{"\n"}
				<span {...stylex.props(styles.toolAccent)}>{summary.value}</span>
			</>
		);
	} else if (summary.type === "command") {
		highlight = (
			<span {...stylex.props(styles.toolAccent)}>$ {summary.value}</span>
		);
	} else if (summary.type === "pattern") {
		highlight = (
			<span {...stylex.props(styles.toolAccent)}>/{summary.value}/</span>
		);
	} else if (summary.type === "accent") {
		highlight = (
			<span {...stylex.props(styles.toolAccent)}>{summary.value}</span>
		);
	} else if (summary.type === "url") {
		highlight = (
			<a
				href={summary.value}
				target="_blank"
				rel="noopener noreferrer"
				{...stylex.props(styles.toolLink)}
			>
				{summary.value}
			</a>
		);
	} else {
		highlight = summary.value;
	}
	return (
		<>
			{highlight}
			{trailingOutput && (
				<>
					{"\n"}
					{trailingOutput}
				</>
			)}
		</>
	);
}
