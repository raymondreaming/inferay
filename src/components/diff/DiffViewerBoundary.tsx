import * as stylex from "@stylexjs/stylex";
import type React from "react";
import { Component } from "react";
import { color, controlSize, font } from "../../tokens.stylex.ts";

interface DiffViewerBoundaryProps {
	children: React.ReactNode;
	resetKey: string;
}

interface DiffViewerBoundaryState {
	error: Error | null;
	resetKey: string;
}

export class DiffViewerBoundary extends Component<
	DiffViewerBoundaryProps,
	DiffViewerBoundaryState
> {
	override state: DiffViewerBoundaryState = {
		error: null,
		resetKey: this.props.resetKey,
	};

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	static getDerivedStateFromProps(
		props: DiffViewerBoundaryProps,
		state: DiffViewerBoundaryState
	) {
		if (props.resetKey !== state.resetKey) {
			return { error: null, resetKey: props.resetKey };
		}
		return null;
	}

	override render() {
		if (this.state.error) {
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

		return this.props.children;
	}
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
