import * as stylex from "@octanejs/stylex";
import { ErrorBoundary, useEffect } from "octane";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

function ChatPaneRecovery({
	error,
	reset,
}: {
	error: unknown;
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[chat] Chat pane render failed:", error);
	}, [error]);

	return (
		<div {...stylex.props(styles.root)} role="alert">
			<div {...stylex.props(styles.card)}>
				<div {...stylex.props(styles.title)}>This chat pane hit a problem.</div>
				<div {...stylex.props(styles.message)}>
					The rest of your workspace is still available.
				</div>
				<button type="button" onClick={reset} {...stylex.props(styles.button)}>
					Reload pane
				</button>
			</div>
		</div>
	);
}

function renderChatPaneRecovery(error: unknown, reset: () => void) {
	return <ChatPaneRecovery error={error} reset={reset} />;
}

export function ChatPaneBoundary({ children }: { children: unknown }) {
	return (
		<ErrorBoundary fallback={renderChatPaneRecovery}>{children}</ErrorBoundary>
	);
}

const styles = stylex.create({
	root: {
		alignItems: "center",
		backgroundColor: color.background,
		display: "flex",
		height: "100%",
		justifyContent: "center",
		minHeight: 0,
		padding: controlSize._4,
	},
	card: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		maxWidth: 320,
		padding: controlSize._5,
		textAlign: "center",
	},
	title: {
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	message: {
		color: color.textMuted,
		fontSize: font.size_2,
	},
	button: {
		backgroundColor: color.surfaceControl,
		borderColor: color.border,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		cursor: "pointer",
		fontSize: font.size_2,
		marginTop: controlSize._1,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
});
