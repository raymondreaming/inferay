import type React from "react";
import { Component } from "react";

interface DiffViewerBoundaryProps {
	children: React.ReactNode;
	resetKey: string;
}

interface DiffViewerBoundaryState {
	error: Error | null;
}

export class DiffViewerBoundary extends Component<
	DiffViewerBoundaryProps,
	DiffViewerBoundaryState
> {
	state: DiffViewerBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidUpdate(prevProps: DiffViewerBoundaryProps) {
		if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
			this.setState({ error: null });
		}
	}

	render() {
		if (this.state.error) {
			return (
				<div
					style={{
						alignItems: "center",
						background: "#0f1115",
						color: "#e6edf3",
						display: "flex",
						fontFamily: "var(--font-body)",
						height: "100%",
						justifyContent: "center",
						minHeight: 240,
						padding: 24,
						textAlign: "center",
					}}
				>
					<div>
						<div style={{ fontSize: 14, fontWeight: 600 }}>
							Diff viewer could not render this file.
						</div>
						<div
							style={{
								color: "#8b949e",
								fontSize: 12,
								marginTop: 8,
								maxWidth: 520,
							}}
						>
							Select another file, then return to this one. The raw git diff is
							still available from the terminal.
						</div>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
