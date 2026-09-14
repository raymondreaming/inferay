import * as stylex from "@stylexjs/stylex";
import type { ChatMessage } from "../AgentChatView/useChatConnection.tsx";
import { Markdown } from "../ChatRichContent/index.tsx";
import { styles } from "./styles.ts";

/** Renders the lightweight conversational aside message variant. */
export function BtwMessage(props: {
	message: ChatMessage;
	onMdFileClick?: (path: string) => void;
}) {
	return (
		<div {...stylex.attrs(styles.btwCard)}>
			<div {...stylex.attrs(styles.btwHeader)}>
				<span {...stylex.attrs(styles.btwLabel)}>btw</span>
				{props.message.btwQuestion && (
					<span {...stylex.attrs(styles.btwQuestion)}>
						- {props.message.btwQuestion}
					</span>
				)}
			</div>
			<div {...stylex.attrs(styles.btwBody)}>
				{props.message.content ? (
					<Markdown
						text={props.message.content}
						onMdFileClick={props.onMdFileClick}
						streaming={props.message.isStreaming}
					/>
				) : props.message.isStreaming ? (
					<div {...stylex.attrs(styles.btwDots)}>
						<span {...stylex.attrs(styles.smallDot)} />
						<span {...stylex.attrs(styles.smallDot, styles.dot2)} />
						<span {...stylex.attrs(styles.smallDot, styles.dot3)} />
					</div>
				) : null}
			</div>
		</div>
	);
}
