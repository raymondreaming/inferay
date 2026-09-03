import * as stylex from "@octanejs/stylex";
import { ErrorBoundary } from "octane";
import { color, controlSize, font } from "../../../tokens.stylex.ts";

interface DiffViewerBoundaryProps {
	children: unknown;
	resetKey: string;
}

function DiffFallback() {
	return (
		<div {...stylex.props(styles.fallback)}>
			<div>
				<div {...stylex.props(styles.title)}>
					Diff viewer could not render this file.
				</div>
				<div {...stylex.props(styles.description)}>
					Select another file, then return to this one. The raw git diff is
					still available from the agent.
				</div>
			</div>
		</div>
	);
}

export function DiffViewerBoundary({
	children,
	resetKey,
}: DiffViewerBoundaryProps) {
	return (
		<ErrorBoundary key={resetKey} fallback={<DiffFallback />}>
			{children}
		</ErrorBoundary>
	);
}

const styles = stylex.create({
	fallback: {
		alignItems: "center",
		backgroundColor: color.background,
		color: color.textMain,
		display: "flex",
		fontFamily: "var(--font-body)",
		height: "100%",
		justifyContent: "center",
		minHeight: 240,
		padding: controlSize._6,
		textAlign: "center",
	},
	title: {
		fontSize: font.size_4,
		fontWeight: font.weight_6,
	},
	description: {
		color: color.textMuted,
		fontSize: font.size_2,
		marginTop: controlSize._2,
		maxWidth: 520,
	},
});
