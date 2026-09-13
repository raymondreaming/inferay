import type { McpElicitation } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { IconExternalLink, IconHelpCircle } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal } from "solid-js";
import { styles } from "./styles.ts";

/** An MCP server's request for a user decision, kept separate from chat rendering. */
export function McpElicitationCard(props: {
	elicitation: McpElicitation;
	isStreaming?: boolean;
	onSendMessage?: (text: string) => void;
}) {
	const [answered, setAnswered] = createSignal<"accept" | "decline" | null>(
		null,
	);
	const [typed, setTyped] = createSignal("");
	const prompt = createMemo(() => props.elicitation.prompt);
	const respond = (decision: "accept" | "decline") => {
		if (answered() || !props.onSendMessage) return;
		setAnswered(decision);
		const reply =
			decision === "decline"
				? "decline"
				: prompt() && typed().trim()
					? typed().trim()
					: "connect";
		props.onSendMessage(reply);
	};
	return (
		<div {...stylex.attrs(styles.questionCard)}>
			<div {...stylex.attrs(styles.questionHeader)}>
				<IconHelpCircle size={iconSize.sm} />
				<span {...stylex.attrs(styles.questionText)}>Connection requested</span>
				{props.elicitation.server && (
					<span {...stylex.attrs(styles.elicitationServer)}>
						{props.elicitation.server}
					</span>
				)}
			</div>
			<p {...stylex.attrs(styles.elicitationMessage)}>
				{props.elicitation.message}
			</p>
			{props.elicitation.url && (
				<a
					{...stylex.attrs(styles.elicitationLink)}
					href={props.elicitation.url}
					target="_blank"
					rel="noreferrer noopener"
				>
					{props.elicitation.url}
				</a>
			)}
			{prompt() && !answered() && (
				<input
					{...stylex.attrs(styles.elicitationField)}
					type="text"
					placeholder={prompt()!}
					value={typed()}
					onInput={(event) => setTyped(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") respond("accept");
					}}
				/>
			)}
			{answered() === null ? (
				<div {...stylex.attrs(styles.elicitationActions)}>
					<button
						type="button"
						{...stylex.attrs(styles.elicitationAccept)}
						onClick={() => respond("accept")}
					>
						{props.elicitation.url ? (
							<IconExternalLink size={iconSize.xs} />
						) : null}
						{prompt() ? "Send" : "Connect"}
					</button>
					<button
						type="button"
						{...stylex.attrs(styles.elicitationDecline)}
						onClick={() => respond("decline")}
					>
						Not now
					</button>
				</div>
			) : (
				<div {...stylex.attrs(styles.elicitationSettled)}>
					{answered() === "accept" ? "Sent to the server." : "Declined."}
				</div>
			)}
		</div>
	);
}
