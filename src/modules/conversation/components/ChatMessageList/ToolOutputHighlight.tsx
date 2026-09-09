import * as stylex from "@stylexjs/stylex";
import { createMemo, Match, Switch } from "solid-js";
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
			? _props.render?.outputStart !== undefined
				? _props.content.slice(_props.render.outputStart)
				: ""
			: "",
	);
	return (
		<>
			<Switch fallback={summary().value}>
				<Match
					when={summary().type === "edit" || summary().type === "file-content"}
				>
					<span {...stylex.attrs(styles.toolMuted)}>{summary().fileName}</span>
					{"\n"}
					<span {...stylex.attrs(styles.toolAccent)}>{summary().value}</span>
				</Match>
				<Match when={summary().type === "command"}>
					<span {...stylex.attrs(styles.toolAccent)}>$ {summary().value}</span>
				</Match>
				<Match when={summary().type === "pattern"}>
					<span {...stylex.attrs(styles.toolAccent)}>/{summary().value}/</span>
				</Match>
				<Match when={summary().type === "accent"}>
					<span {...stylex.attrs(styles.toolAccent)}>{summary().value}</span>
				</Match>
				<Match when={summary().type === "url"}>
					<a
						href={summary().value}
						target="_blank"
						rel="noopener noreferrer"
						{...stylex.attrs(styles.toolLink)}
					>
						{summary().value}
					</a>
				</Match>
			</Switch>
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
